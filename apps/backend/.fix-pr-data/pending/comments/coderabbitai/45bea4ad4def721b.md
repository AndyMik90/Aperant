# Comment: 45bea4ad4def721b

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/main/ipc-handlers/linear-handlers.ts`
**Line:** 736
**Original ID:** 2735315781
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Misleading GraphQL variable naming.**

The mutation declares `$labels: [String!]!` but uses it as `labelIds: $labels`. While the code at lines 830-833 correctly passes label IDs, this naming inconsistency could confuse future maintainers.



<details>
<summary>♻️ Clearer naming</summary>

```diff
 const mutation = `
-  mutation($issueId: ID!, $labels: [String!]!) {
-    issueUpdate(id: $issueId, input: { labelIds: $labels }) {
+  mutation($issueId: ID!, $labelIds: [String!]!) {
+    issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
       success
       issue {
         id
         labels {
           nodes {
             id
             name
           }
         }
       }
     }
   }
 `;
 
 // ... later ...
 
 await linearGraphQL(apiKey, mutation, {
   issueId: ticketId,
-  labels: labelIds,
+  labelIds: labelIds,
 });
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
				const mutation = `
          mutation($issueId: ID!, $labelIds: [String!]!) {
            issueUpdate(id: $issueId, input: { labelIds: $labelIds }) {
              success
              issue {
                id
                labels {
                  nodes {
                    id
                    name
                  }
                }
              }
            }
          }
        `;
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/main/ipc-handlers/linear-handlers.ts` around lines 743 -
758, The GraphQL mutation's variable is misleadingly named `$labels` while it's
used as `labelIds`; update the mutation string (the `mutation` template) to
declare `$labelIds: [String!]!` and reference `labelIds: $labelIds` in the
input, and also update the variables payload (where you currently pass `labels`)
to use `labelIds` so the variable name matches usage throughout
`linear-handlers.ts`.
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


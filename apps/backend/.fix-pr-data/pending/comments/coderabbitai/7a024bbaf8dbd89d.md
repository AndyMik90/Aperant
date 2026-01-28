# Comment: 7a024bbaf8dbd89d

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/ResolutionCheckDialog.tsx`
**Line:** 34
**Original ID:** 2735948325
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Prefer shared Resolution* types to avoid drift.**

If `ResolutionEvidence` and `ResolutionTicketResult` already exist in `apps/frontend/src/shared/types/integrations.ts`, import them instead of redefining locally to prevent type divergence.

<details>
<summary>♻️ Suggested refactor</summary>

```diff
-import { CheckCircle2, GitCommit, Package, X } from "lucide-react";
+import { CheckCircle2, GitCommit, Package, X } from "lucide-react";
+import type {
+  ResolutionEvidence,
+  ResolutionTicketResult,
+} from "../../../../shared/types/integrations";
...
-export interface ResolutionEvidence {
-  type: "commit" | "release" | "code_change";
-  description: string;
-  url: string;
-  date: string;
-}
-
-export interface ResolutionTicketResult {
-  ticket_id: string;
-  is_already_fixed: boolean;
-  confidence: "high" | "medium" | "low";
-  evidence: ResolutionEvidence[];
-  reasoning: string;
-  recommended_action: "close" | "keep_open" | "investigate";
-  suggested_close_reason?: string;
-}
```
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In
`@apps/frontend/src/renderer/components/linear/components/ResolutionCheckDialog.tsx`
around lines 19 - 34, The local interfaces ResolutionEvidence and
ResolutionTicketResult in ResolutionCheckDialog.tsx should be removed and the
shared definitions imported from the central types file (use the existing types
in apps/frontend/src/shared/types/integrations.ts); replace the local
declarations with an import statement that brings in ResolutionEvidence and
ResolutionTicketResult, update any code that referenced the local types to use
the imported symbols, and delete the duplicate interface declarations to avoid
type drift.
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


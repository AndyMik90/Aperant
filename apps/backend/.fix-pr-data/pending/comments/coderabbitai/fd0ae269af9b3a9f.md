# Comment: fd0ae269af9b3a9f

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/main/ipc-handlers/linear-handlers.ts`
**Line:** 56
**Original ID:** 2735038513
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_🛠️ Refactor suggestion_ | _🟠 Major_

**Use platform `joinPaths` for cross‑platform path handling.**

`path.join` is used to build project/spec paths. The repo’s platform layer provides `joinPaths()` to keep path handling consistent and cross‑platform across Electron contexts. Consider swapping these (and the other `path.join` usages in this file) to the platform helper.  
As per coding guidelines, cross-platform executable lookup and path handling must use `findExecutable()`, `getPathDelimiter()`, `joinPaths()`, and `requiresShell()` functions from platform modules.

<details>
<summary>♻️ Suggested adjustment (example)</summary>

```diff
-import path from "path";
+import { joinPaths } from "../platform/paths";
 
-const envPath = path.join(project.path, project.autoBuildPath, ".env");
+const envPath = joinPaths(project.path, project.autoBuildPath, ".env");
```
</details>



Also applies to: 498-546

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/main/ipc-handlers/linear-handlers.ts` around lines 44 - 56,
The getLinearApiKey function (and other path-building sites in this file)
currently uses path.join which is not cross-platform safe for our Electron
contexts; import and use the platform helper joinPaths instead of path.join
inside getLinearApiKey (and replace the other path.join usages in this file) so
paths are normalized consistently; additionally, when dealing with
cross-platform executable lookup or PATH handling in this file, switch to the
platform helpers findExecutable, getPathDelimiter and requiresShell where
appropriate to follow repo guidelines.
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


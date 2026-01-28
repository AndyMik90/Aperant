# Comment: c6c1bffe6d4e0b56

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/Sidebar.tsx`
**Line:** 134
**Original ID:** 2734046549
**Created:** None
**Severity:** HIGH
**Status:** RESOLVED

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Use a functional update for `toggleSidebar` to avoid stale state.**

`setIsCollapsed(!isCollapsed)` can flip based on stale state in rapid/queued updates. Prefer a functional setter.


<details>
<summary>🔁 Suggested change</summary>

```diff
-  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
+  const toggleSidebar = () => setIsCollapsed((prev) => !prev);
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [envConfig, setEnvConfig] = useState<{
    githubEnabled?: boolean;
    gitlabEnabled?: boolean;
    linearEnabled?: boolean;
  } | null>(null);

  const toggleSidebar = () => setIsCollapsed((prev) => !prev);

```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/renderer/components/Sidebar.tsx` around lines 126 - 134,
The toggleSidebar handler uses setIsCollapsed(!isCollapsed) which can read stale
state; change toggleSidebar to use the functional updater form
setIsCollapsed(prev => !prev) so toggling uses the latest state. Update the
toggleSidebar function definition (and any other places calling setIsCollapsed)
to use the functional setter to avoid race conditions with rapid or queued
updates.
```

</details>

<!-- fingerprinting:phantom:poseidon:eagle -->

<!-- This is an auto-generated comment by CodeRabbit -->

✅ Addressed in commits ef15aee to 06c64be

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

*Status: RESOLVED*

**Resolution:** Body contains resolution marker

**Resolved At:** 2026-01-28T15:40:48.084707


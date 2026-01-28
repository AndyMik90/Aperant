# Comment: b1c88ee74fe23aee

**Source:** coderabbitai
**Type:** comment
**File:** `apps/backend/agents/linear_validator.py`
**Line:** 138
**Original ID:** 2713898389
**Created:** None
**Severity:** LOW
**Status:** SKIPPED

---

## Original Content

_🧹 Nitpick_ | _🔵 Trivial_

**Move `import random` to module level.**

The `random` module is imported inside the loop on every retry with jitter. This should be moved to the top of the file for efficiency.

<details>
<summary>Proposed fix</summary>

```diff
 import asyncio
 import logging
+import random
 from collections.abc import Callable
 from pathlib import Path
 # ...

             # Add jitter to avoid thundering herd
             if config.jitter:
-                import random
-
                 delay = delay * (0.5 + random.random())
```
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/backend/agents/linear_validator.py` around lines 132 - 136, The import
random is being done inside the retry block where config.jitter is checked
causing repeated imports; move the import to module level by adding a single
"import random" at the top of the file and remove the inline "import random" in
the jitter block so the code that modifies delay (delay = delay * (0.5 +
random.random())) uses the top-level module instead; update any
linter/unused-import checks accordingly and ensure no other references rely on
the in-block import.
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Suggested Fix

```python
</details>

<details>
<summary>🤖 Prompt for AI Agents</summary>
```

---

## Implementation Notes

*Status: SKIPPED*

**Resolution:** Already fixed - import random is at module level (line 19)
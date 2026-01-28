# Comment: 5cf9fcd822bfaa86

**Source:** coderabbitai
**Type:** comment
**File:** `apps/backend/agents/linear_validator.py`
**Original ID:** 2713898397
**Created:** None
**Severity:** CRITICAL
**Status:** RESOLVED

---

## Original Content

_⚠️ Potential issue_ | _🔴 Critical_

**Bug: returns raw `issue_id` instead of error message.**

When the error contains "404" or "not found" and `issue_id` is provided, the function returns just the `issue_id` string instead of a formatted error message. This appears to be a copy-paste error.

<details>
<summary>Proposed fix</summary>

```diff
     if "404" in error_message or "not found" in error_message:
-        return (
-            issue_id if issue_id else "Ticket not found. Please verify the ticket ID."
-        )
+        if issue_id:
+            return f"Ticket '{issue_id}' not found. Please verify the ticket ID."
+        return "Ticket not found. Please verify the ticket ID."
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
    if "404" in error_message or "not found" in error_message:
        if issue_id:
            return f"Ticket '{issue_id}' not found. Please verify the ticket ID."
        return "Ticket not found. Please verify the ticket ID."
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/backend/agents/linear_validator.py` around lines 278 - 281, The branch
that checks if "404" or "not found" is in error_message incorrectly returns the
raw issue_id when issue_id is present; update it to return a formatted error
message including the issue_id (e.g., "Ticket {issue_id} not found. Please
verify the ticket ID.") instead of returning issue_id directly, keeping the
existing fallback "Ticket not found. Please verify the ticket ID." when issue_id
is falsy; locate the snippet using the variables error_message and issue_id in
this file and replace the return expression accordingly.
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Suggested Fix

```python
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.
```

---

## Implementation Notes

*Status: RESOLVED*

**Resolution:** 404 error handling already returns formatted message with issue_id on lines 283-286

### Fix Commit

`8ec7c9e5c11c4a7b9e17bb55f5a31a01ec3cd259`
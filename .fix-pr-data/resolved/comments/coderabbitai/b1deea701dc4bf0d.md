# Comment: b1deea701dc4bf0d

**Source:** coderabbitai
**Type:** comment
**File:** `apps/backend/runners/linear_validation_runner.py`
**Original ID:** 2717221755
**Created:** None
**Severity:** HIGH
**Status:** RESOLVED

---

## Original Content

_⚠️ Potential issue_ | _🟡 Minor_

**Empty ticket IDs not filtered after split.**

If `--ticket-ids` contains empty strings (e.g., `"LIN-123,,LIN-456"`), they will be included after `strip()` and passed to validation, potentially causing errors.


<details>
<summary>🐛 Proposed fix</summary>

```diff
-        ticket_ids = [t.strip() for t in args.ticket_ids.split(",")]
+        ticket_ids = [t.strip() for t in args.ticket_ids.split(",") if t.strip()]
         if len(ticket_ids) > 5:
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
        ticket_ids = [t.strip() for t in args.ticket_ids.split(",") if t.strip()]
        if len(ticket_ids) > 5:
            output_result(
                {"success": False, "error": "Maximum 5 tickets allowed per batch"}
            )
            sys.exit(1)
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/backend/runners/linear_validation_runner.py` around lines 278 - 283, The
current creation of ticket_ids from args.ticket_ids uses [t.strip() for t in
args.ticket_ids.split(",")] which leaves empty strings when input contains
consecutive commas; update the logic that builds ticket_ids (the variable
derived from args.ticket_ids in linear_validation_runner.py) to filter out
empty/whitespace-only entries (i.e., only include t.strip() when non-empty),
then use that filtered ticket_ids for the length check and the subsequent
validation flow, and keep the existing output_result and sys.exit(1) behavior
when the filtered list exceeds 5.
```

</details>

<!-- fingerprinting:phantom:poseidon:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

✅ Addressed in commits 12e7884 to 1f1d23a

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

**Resolution:** Body contains resolution marker

**Resolved At:** 2026-01-28T15:40:31.934776


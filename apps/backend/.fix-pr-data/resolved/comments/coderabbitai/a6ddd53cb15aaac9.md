# Comment: a6ddd53cb15aaac9

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
**Line:** 110
**Original ID:** 2717221837
**Created:** None
**Severity:** HIGH
**Status:** RESOLVED

---

## Original Content

_⚠️ Potential issue_ | _🟡 Minor_

**Hardcoded aria-label "Open in Linear" violates i18n requirements.**

The aria-label on the external link uses a hardcoded English string.


<details>
<summary>🌐 Proposed fix</summary>

```diff
 						<a
 							href={ticket.url}
 							target="_blank"
 							rel="noopener noreferrer"
 							className="text-muted-foreground hover:text-foreground transition-colors"
-							aria-label="Open in Linear"
+							aria-label={t("linear:openInLinear")}
 						>
```
</details>

<!-- suggestion_start -->

<details>
<summary>📝 Committable suggestion</summary>

> ‼️ **IMPORTANT**
> Carefully review the code before committing. Ensure that it accurately replaces the highlighted code, contains no missing lines, and has no issues with indentation. Thoroughly test & benchmark the code to ensure it meets the requirements.

```suggestion
					<a
						href={ticket.url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-muted-foreground hover:text-foreground transition-colors"
						aria-label={t("linear:openInLinear")}
					>
						<ExternalLink className="w-4 h-4 flex-shrink-0" />
					</a>
```

</details>

<!-- suggestion_end -->

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In
`@apps/frontend/src/renderer/components/linear/components/LinearTicketDetail.tsx`
around lines 90 - 98, The anchor in LinearTicketDetail.tsx uses a hardcoded
aria-label ("Open in Linear"); replace it with a translatable string by calling
the app's i18n hook/utility (e.g., useTranslation()/t or
useIntl().formatMessage) and pass the translated label into the aria-label on
the <a> element; add a new locale key (e.g., "openInLinear" or "open_in_linear")
to the translation files with the appropriate default English value and any
other locales. Ensure you import/initialize the same translation helper used
across the codebase inside LinearTicketDetail and use that translated value for
the aria-label.
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

✅ Addressed in commits 26b4487 to e532ad1

---

## Suggested Fix

```typescript
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

**Resolved At:** 2026-01-28T18:34:49.230698


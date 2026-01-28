# Comment: fbdae22772fa4fb2

**Source:** github-advanced-security
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearTicketItem.tsx`
**Original ID:** 2715994391
**Created:** None
**Severity:** CRITICAL
**Status:** RESOLVED

---

## Original Content

## Useless conditional

This use of variable 'hasResult' always evaluates to true.

[Show more details](https://github.com/AndyMik90/Auto-Claude/security/code-scanning/2144)

---

## Implementation Notes

*Status: RESOLVED*

**Resolution:** Removed unreachable code (lines 102-103 checking hasResult after isValidating)

### Fix Commit

`8ec7c9e5c11c4a7b9e17bb55f5a31a01ec3cd259`
# Comment: a8bcf5e86de577bb

**Source:** coderabbitai
**Type:** comment
**File:** `apps/frontend/src/renderer/components/linear/components/LinearFilterBar.tsx`
**Line:** 442
**Original ID:** 2717221814
**Created:** None
**Severity:** HIGH
**Status:** PENDING

---

## Original Content

_⚠️ Potential issue_ | _🟡 Minor_

**SingleSelectDropdown lacks keyboard navigation.**

`FilterDropdown` implements keyboard navigation (ArrowUp/Down, Enter/Space, Escape), but `SingleSelectDropdown` does not. This creates an inconsistent accessibility experience between multi-select and single-select filters.



Consider adding similar keyboard navigation to `SingleSelectDropdown` for consistency and better accessibility.

<details>
<summary>🤖 Prompt for AI Agents</summary>

```
In `@apps/frontend/src/renderer/components/linear/components/LinearFilterBar.tsx`
around lines 344 - 443, SingleSelectDropdown is missing keyboard navigation
(ArrowUp/Down, Enter/Space, Escape) causing inconsistent accessibility; add
keyboard handling similar to FilterDropdown by tracking an activeIndex (useRef
or useState) when DropdownMenu is open, add a keydown handler on the listbox
container (role="listbox") to move activeIndex on ArrowUp/ArrowDown, select the
active item on Enter/Space by invoking handleSelect(items[activeIndex].value),
and close the menu on Escape by calling setIsOpen(false); ensure each option
element uses tabIndex={-1} (or aria-activedescendant) and applies a visual focus
style when index === activeIndex so keyboard users can see the highlighted
option.
```

</details>

<!-- fingerprinting:phantom:medusa:ocelot -->

<!-- This is an auto-generated comment by CodeRabbit -->

---

## Implementation Notes

*Status: PENDING - Not yet verified or implemented*

### Verification Checklist

- [ ] Read file at comment location
- [ ] Verify if issue is already fixed
- [ ] Implement fix if needed
- [ ] Re-verify after implementation


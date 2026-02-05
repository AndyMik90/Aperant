# Fix: Aria-Hidden Focus Error (Task Stops)

**Created:** 2026-02-04
**Priority:** High
**Status:** Pending

---

## Problem

Task stops unexpectedly with this console error:

```
Blocked aria-hidden on an element because its descendant retained focus.
The focus must not be hidden from assistive technology users.
Avoid using aria-hidden on a focused element or its ancestor.
Consider using the inert attribute instead.

Element with focus: <span>
Ancestor with aria-hidden: <span data-radix-focus-guard tabindex="0" data-aria-hidden="true" aria-hidden="true">
```

---

## Root Cause

This is a **Radix UI focus guard** issue. When a dialog/modal closes, the focus guard element has `aria-hidden="true"` but still has focus, which is an accessibility violation.

The browser blocks this, and it may be causing the task to stop due to an unhandled error propagating up.

---

## Likely Culprits

1. **Dialog components closing** while something inside has focus
2. **Popover/dropdown menus** closing without proper focus management
3. **Select components** (Radix Select) with focus issues

### Files to Check:
- `src/renderer/components/ui/dialog.tsx`
- `src/renderer/components/ui/popover.tsx`
- `src/renderer/components/ui/select.tsx`
- Any component using `Dialog`, `Popover`, or `Select` from Radix

---

## Console Log Analysis

The log shows the task was running fine:
```
[TerminalStore] Task 001-phase-1-critical-fixes-make-credit-chain-bootable is planning but no process running, will restart planning agent
[TerminalStore] Restarting stuck task: 001-phase-1-critical-fixes-make-credit-chain-bootable
[TerminalStore] Task 001-phase-1-critical-fixes-make-credit-chain-bootable restarted successfully
```

Then the aria-hidden error occurs and task stops.

---

## Potential Fixes

### Option 1: Use `inert` attribute instead of `aria-hidden`
```tsx
// Instead of aria-hidden
<div aria-hidden={isHidden}>

// Use inert (modern browsers)
<div inert={isHidden ? "" : undefined}>
```

### Option 2: Ensure focus is moved before hiding
```tsx
// Before closing dialog, move focus
const handleClose = () => {
  document.body.focus(); // or focus a specific element
  setOpen(false);
};
```

### Option 3: Update Radix UI packages
Check if newer versions of Radix have fixed this:
```bash
npm update @radix-ui/react-dialog @radix-ui/react-popover @radix-ui/react-select
```

### Option 4: Add error boundary
Wrap the task panel in an error boundary to prevent focus errors from killing the task:
```tsx
<ErrorBoundary fallback={<TaskError />}>
  <TaskPanel />
</ErrorBoundary>
```

---

## Reproduction Steps

1. Start a task (planning phase)
2. Task runs and shows progress
3. Interact with UI (click buttons, open dropdowns)
4. Task stops unexpectedly
5. Check console for aria-hidden error

---

## Notes

- This might be intermittent - only happens when specific UI interactions occur
- The error is an accessibility violation, so modern browsers are strict about it
- May need to audit all Radix component usage for proper focus management

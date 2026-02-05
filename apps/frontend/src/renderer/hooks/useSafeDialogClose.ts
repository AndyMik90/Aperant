import { useCallback, useRef } from 'react';

/**
 * Hook to safely close dialogs without aria-hidden focus errors.
 *
 * The aria-hidden focus error occurs when:
 * 1. Focus is inside a dialog/modal
 * 2. The dialog closes and adds aria-hidden="true"
 * 3. But focus is still inside the now-hidden element
 *
 * This hook provides a safe close handler that moves focus before closing.
 */
export function useSafeDialogClose(onOpenChange: (open: boolean) => void) {
  const triggerRef = useRef<HTMLElement | null>(null);

  // Store the element that opened the dialog
  const setTriggerRef = useCallback((element: HTMLElement | null) => {
    triggerRef.current = element;
  }, []);

  // Safely close the dialog by moving focus first
  const safeClose = useCallback(() => {
    // Move focus to the trigger element or document body before closing
    // This prevents the aria-hidden focus trap error
    if (triggerRef.current && document.body.contains(triggerRef.current)) {
      triggerRef.current.focus();
    } else {
      // Fallback: blur the current element to move focus out of the dialog
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }

    // Use requestAnimationFrame to ensure focus has moved before state change
    requestAnimationFrame(() => {
      onOpenChange(false);
    });
  }, [onOpenChange]);

  // Wrapped onOpenChange that handles close safely
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      safeClose();
    } else {
      // Store the currently focused element as the trigger
      if (document.activeElement instanceof HTMLElement) {
        triggerRef.current = document.activeElement;
      }
      onOpenChange(true);
    }
  }, [onOpenChange, safeClose]);

  return {
    triggerRef,
    setTriggerRef,
    safeClose,
    handleOpenChange,
  };
}

/**
 * Simple utility to blur focus before closing a dialog.
 * Use this for quick fixes without the full hook.
 */
export function blurAndClose(onClose: () => void) {
  // Blur current focus to prevent aria-hidden error
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  // Use requestAnimationFrame to ensure blur completes before close
  requestAnimationFrame(() => {
    onClose();
  });
}

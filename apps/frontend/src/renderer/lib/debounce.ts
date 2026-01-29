/**
 * Debounce utility function
 * Prevents excessive calls to a function by only invoking it after a delay
 * has passed since the last invocation.
 *
 * Returns an object with:
 * - fn: The debounced function to call
 * - cancel: A method to cancel any pending debounced call
 *
 * @example
 * const debounced = debounce(() => console.log('called'), 300);
 * debounced.fn(); // Will call after 300ms if not called again
 * debounced.cancel(); // Cancels the pending call
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): { fn: T; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const debouncedFn = ((...args: unknown[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return { fn: debouncedFn, cancel };
}

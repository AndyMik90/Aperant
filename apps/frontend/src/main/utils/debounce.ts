/**
 * Debounce utility with leading and trailing edge support
 *
 * Creates a debounced function that delays invoking `fn` until after `wait` milliseconds
 * have elapsed since the last time it was invoked.
 *
 * @param fn - The function to debounce
 * @param wait - The number of milliseconds to delay
 * @param options - Configuration options
 * @param options.leading - Invoke on the leading edge of the timeout (default: false)
 * @param options.trailing - Invoke on the trailing edge of the timeout (default: true)
 * @returns An object with the debounced function and a cancel method
 *
 * @example
 * // Leading + trailing: execute immediately and after delay
 * const { fn, cancel } = debounce(saveData, 300, { leading: true, trailing: true });
 * fn(); // Executes immediately
 * fn(); // Schedules for 300ms later
 * fn(); // Reschedules for 300ms later (only final call executes)
 *
 * @example
 * // Trailing only (default): execute only after delay
 * const { fn, cancel } = debounce(saveData, 300);
 * fn(); // Schedules for 300ms later
 * fn(); // Reschedules for 300ms later
 */
export function debounce<TArgs extends unknown[], TReturn = void>(
  fn: (...args: TArgs) => TReturn,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): { fn: (...args: TArgs) => void; cancel: () => void } {
  const { leading = false, trailing = true } = options;

  let timeoutId: NodeJS.Timeout | null = null;
  let lastCallTime: number | null = null;
  let hasTrailingArgs = false;

  const invokeFunc = (args: TArgs) => {
    fn(...args);
  };

  const debouncedFn = (...args: TArgs): void => {
    const now = Date.now();
    const isFirstCall = lastCallTime === null;

    lastCallTime = now;

    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Leading edge: invoke immediately on first call
    if (leading && isFirstCall) {
      invokeFunc(args);
      hasTrailingArgs = false;
    } else {
      // Mark that there are pending args for trailing invocation
      hasTrailingArgs = true;
    }

    // Trailing edge: schedule invocation after wait period
    if (trailing) {
      timeoutId = setTimeout(() => {
        // Only invoke trailing if there were calls after the leading invocation
        if (hasTrailingArgs) {
          invokeFunc(args);
        }
        lastCallTime = null;
        timeoutId = null;
        hasTrailingArgs = false;
      }, wait);
    } else if (leading) {
      // Leading-only: schedule state reset so next burst triggers leading edge again
      timeoutId = setTimeout(() => {
        lastCallTime = null;
        timeoutId = null;
      }, wait);
    } else {
      // Reset state if neither leading nor trailing
      lastCallTime = null;
    }
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastCallTime = null;
    hasTrailingArgs = false;
  };

  return { fn: debouncedFn, cancel };
}

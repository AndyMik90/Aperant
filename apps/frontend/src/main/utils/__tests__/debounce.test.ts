/**
 * Tests for debounce utility - leading/trailing edge debouncing with cancel support.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { debounce } from '../debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('trailing-only mode (default)', () => {
    it('should invoke after wait period', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300);

      fn();
      expect(spy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should only invoke once for rapid calls', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300);

      fn('a');
      fn('b');
      fn('c');

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('c');
    });

    it('should reset timer on each call', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300);

      fn();
      vi.advanceTimersByTime(200);
      fn();
      vi.advanceTimersByTime(200);

      expect(spy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('leading-only mode', () => {
    it('should invoke immediately on first call', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: false });

      fn();
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should not invoke again during wait period', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: false });

      fn();
      fn();
      fn();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should invoke again after wait period expires (new burst)', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: false });

      fn('first');
      expect(spy).toHaveBeenCalledTimes(1);

      // Wait for the debounce period to expire
      vi.advanceTimersByTime(300);

      // New burst should trigger leading edge again
      fn('second');
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith('second');
    });
  });

  describe('leading + trailing mode', () => {
    it('should invoke immediately on first call (leading edge)', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: true });

      fn('first');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('first');
    });

    it('should NOT double-invoke for a single call', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: true });

      fn('only');
      expect(spy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(300);
      // Should still be 1 - no trailing invocation for a single call
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should invoke trailing edge when additional calls occur', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300, { leading: true, trailing: true });

      fn('first');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('first');

      fn('second');
      fn('third');

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenLastCalledWith('third');
    });
  });

  describe('cancel', () => {
    it('should cancel pending trailing invocation', () => {
      const spy = vi.fn();
      const { fn, cancel } = debounce(spy, 300);

      fn();
      cancel();

      vi.advanceTimersByTime(300);
      expect(spy).not.toHaveBeenCalled();
    });

    it('should allow new calls after cancel', () => {
      const spy = vi.fn();
      const { fn, cancel } = debounce(spy, 300);

      fn('first');
      cancel();

      fn('second');
      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('second');
    });

    it('should cancel pending trailing in leading+trailing mode', () => {
      const spy = vi.fn();
      const { fn, cancel } = debounce(spy, 300, { leading: true, trailing: true });

      fn('leading');
      expect(spy).toHaveBeenCalledTimes(1);

      fn('trailing');
      cancel();

      vi.advanceTimersByTime(300);
      // Only the leading call should have fired
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('argument preservation', () => {
    it('should pass the latest arguments to trailing invocation', () => {
      const spy = vi.fn();
      const { fn } = debounce(spy, 300);

      fn(1, 'a');
      fn(2, 'b');
      fn(3, 'c');

      vi.advanceTimersByTime(300);
      expect(spy).toHaveBeenCalledWith(3, 'c');
    });
  });
});

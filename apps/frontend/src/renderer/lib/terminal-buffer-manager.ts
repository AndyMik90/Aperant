/**
 * Terminal Buffer Manager
 *
 * Singleton that manages terminal output buffers outside of React state.
 * This prevents React re-renders on every terminal output chunk.
 *
 * Inspired by VS Code's DisposableStore pattern.
 */

interface Disposable {
  dispose(): void;
}

class TerminalBufferManager {
  private static instance: TerminalBufferManager;
  private buffers = new Map<string, string>();
  private disposables = new Map<string, Disposable[]>();
  private readonly MAX_BUFFER_SIZE = 100_000; // 100KB per terminal

  private constructor() {
    // Private constructor for singleton
  }

  static getInstance(): TerminalBufferManager {
    if (!TerminalBufferManager.instance) {
      TerminalBufferManager.instance = new TerminalBufferManager();
    }
    return TerminalBufferManager.instance;
  }

  /**
   * Append data to a terminal's buffer
   * Automatically truncates to MAX_BUFFER_SIZE
   */
  append(id: string, data: string): void {
    const current = this.buffers.get(id) || '';
    const combined = current + data;

    // Keep only the last MAX_BUFFER_SIZE characters
    const truncated = combined.length > this.MAX_BUFFER_SIZE
      ? combined.slice(-this.MAX_BUFFER_SIZE)
      : combined;

    this.buffers.set(id, truncated);
  }

  /**
   * Get the buffer for a terminal
   */
  get(id: string): string {
    return this.buffers.get(id) || '';
  }

  /**
   * Set the entire buffer (for restoration)
   */
  set(id: string, buffer: string): void {
    this.buffers.set(id, buffer.slice(-this.MAX_BUFFER_SIZE));
  }

  /**
   * Clear a terminal's buffer
   */
  clear(id: string): void {
    this.buffers.delete(id);
  }

  /**
   * Atomically get and clear a terminal's buffer
   * This prevents race conditions where data could be appended between get() and clear()
   */
  getAndClear(id: string): string {
    const buffer = this.buffers.get(id) || '';
    this.buffers.delete(id);
    return buffer;
  }

  /**
   * Check if a terminal has a buffer
   */
  has(id: string): boolean {
    return this.buffers.has(id);
  }

  /**
   * Get buffer size in bytes
   */
  getSize(id: string): number {
    return this.buffers.get(id)?.length || 0;
  }

  /**
   * Register disposables for proper cleanup (VS Code pattern)
   */
  registerDisposable(id: string, ...disposables: Disposable[]): void {
    const existing = this.disposables.get(id) || [];
    this.disposables.set(id, [...existing, ...disposables]);
  }

  /**
   * Full cleanup when terminal is destroyed
   */
  dispose(id: string): void {
    // Dispose all registered resources
    const disposables = this.disposables.get(id);
    if (disposables) {
      for (const disposable of disposables) {
        try {
          disposable.dispose();
        } catch (e) {
          console.warn(`[TerminalBufferManager] Error disposing resource for ${id}:`, e);
        }
      }
      this.disposables.delete(id);
    }

    // Remove buffer
    this.buffers.delete(id);
  }

  /**
   * For session persistence - get all buffers
   */
  getAll(): Map<string, string> {
    return new Map(this.buffers);
  }

  /**
   * Get all terminal IDs with buffers
   */
  getAllIds(): string[] {
    return Array.from(this.buffers.keys());
  }

  /**
   * Get total memory usage across all buffers
   */
  getTotalSize(): number {
    let total = 0;
    for (const buffer of this.buffers.values()) {
      total += buffer.length;
    }
    return total;
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    terminalCount: number;
    totalSizeBytes: number;
    maxBufferSize: number;
    buffers: Array<{ id: string; sizeBytes: number }>;
  } {
    const buffers = Array.from(this.buffers.entries()).map(([id, buffer]) => ({
      id,
      sizeBytes: buffer.length,
    }));

    return {
      terminalCount: this.buffers.size,
      totalSizeBytes: this.getTotalSize(),
      maxBufferSize: this.MAX_BUFFER_SIZE,
      buffers,
    };
  }
}

// Export singleton instance
export const terminalBufferManager = TerminalBufferManager.getInstance();

// For debugging in browser console
if (typeof window !== 'undefined') {
  (window as Window & { __terminalBufferManager?: TerminalBufferManager }).__terminalBufferManager = terminalBufferManager;
}

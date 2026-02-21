/**
 * WebGL Context Manager
 *
 * Manages WebGL context lifecycle with LRU eviction to prevent
 * browser WebGL context exhaustion (typically 8-16 limit).
 *
 * Inspired by VS Code's conditional WebGL loading and Hyper's context management.
 */

import { WebglAddon } from '@xterm/addon-webgl';
import type { Terminal } from '@xterm/xterm';
import { supportsWebGL2, getMaxWebGLContexts, isSafari } from './webgl-utils';

class WebGLContextManager {
  private static instance: WebGLContextManager;
  private readonly MAX_CONTEXTS: number;
  private activeContexts = new Map<string, WebglAddon>();
  private terminals = new Map<string, Terminal>();
  private contextQueue: string[] = []; // LRU tracking
  readonly isSupported: boolean;

  private constructor() {
    // Check WebGL support once at startup
    // Skip WebGL on Safari due to known rendering issues with xterm.js WebGL addon
    // Safari will use Canvas renderer fallback for more stable rendering
    const safariDetected = isSafari();
    this.isSupported = !safariDetected && supportsWebGL2();
    // Use conservative max based on browser detection
    this.MAX_CONTEXTS = Math.min(getMaxWebGLContexts(), 8);

    if (safariDetected) {
      console.warn(
        '[WebGLContextManager] Safari detected - WebGL disabled, using Canvas renderer fallback'
      );
    }
    console.warn(
      `[WebGLContextManager] Initialized - Supported: ${this.isSupported}, Max contexts: ${this.MAX_CONTEXTS}`
    );
  }

  static getInstance(): WebGLContextManager {
    if (!WebGLContextManager.instance) {
      WebGLContextManager.instance = new WebGLContextManager();
    }
    return WebGLContextManager.instance;
  }

  /**
   * Register a terminal for WebGL management
   */
  register(terminalId: string, xterm: Terminal): void {
    this.terminals.set(terminalId, xterm);
    console.warn(`[WebGLContextManager] Registered terminal ${terminalId}`);
  }

  /**
   * Unregister a terminal (called on terminal close)
   */
  unregister(terminalId: string): void {
    this.release(terminalId);
    this.terminals.delete(terminalId);
    // Remove from LRU queue
    this.contextQueue = this.contextQueue.filter((id) => id !== terminalId);
    console.warn(`[WebGLContextManager] Unregistered terminal ${terminalId}`);
  }

  /**
   * Acquire a WebGL context for a terminal (called when visible)
   */
  acquire(terminalId: string): boolean {
    if (!this.isSupported) {
      return false;
    }

    const xterm = this.terminals.get(terminalId);
    if (!xterm) {
      console.warn(`[WebGLContextManager] Terminal ${terminalId} not registered`);
      return false;
    }

    // Already has a context
    if (this.activeContexts.has(terminalId)) {
      // Move to end of LRU queue (mark as recently used)
      this.contextQueue = this.contextQueue.filter((id) => id !== terminalId);
      this.contextQueue.push(terminalId);
      return true;
    }

    // LRU eviction: if at limit, release oldest context
    if (this.activeContexts.size >= this.MAX_CONTEXTS) {
      const oldest = this.contextQueue.shift();
      if (oldest) {
        console.warn(
          `[WebGLContextManager] Evicting oldest context: ${oldest} (at limit ${this.MAX_CONTEXTS})`
        );
        this.release(oldest);
      }
    }

    try {
      const addon = new WebglAddon();

      // Handle context loss gracefully (VS Code pattern)
      addon.onContextLoss(() => {
        console.warn(`[WebGLContextManager] Context lost for terminal ${terminalId}`);
        this.activeContexts.delete(terminalId);
        this.contextQueue = this.contextQueue.filter((id) => id !== terminalId);
        // Terminal will re-acquire on next visibility change
      });

      xterm.loadAddon(addon);
      this.activeContexts.set(terminalId, addon);
      this.contextQueue.push(terminalId);

      console.warn(
        `[WebGLContextManager] Acquired context for ${terminalId} (active: ${this.activeContexts.size}/${this.MAX_CONTEXTS})`
      );
      return true;
    } catch (error) {
      console.warn(`[WebGLContextManager] Failed to acquire context for ${terminalId}:`, error);
      return false; // Falls back to canvas renderer automatically
    }
  }

  /**
   * Release a WebGL context (called when terminal becomes hidden)
   */
  release(terminalId: string): void {
    const addon = this.activeContexts.get(terminalId);
    if (!addon) {
      return;
    }

    try {
      addon.dispose();
      console.warn(
        `[WebGLContextManager] Released context for ${terminalId} (active: ${this.activeContexts.size - 1}/${this.MAX_CONTEXTS})`
      );
    } catch (error) {
      console.warn(`[WebGLContextManager] Error disposing context for ${terminalId}:`, error);
      // Context may already be lost, continue cleanup
    }

    this.activeContexts.delete(terminalId);
    // Remove from queue (will be re-added on next acquire)
    this.contextQueue = this.contextQueue.filter((id) => id !== terminalId);
  }

  /**
   * Check if a terminal has an active WebGL context
   */
  hasContext(terminalId: string): boolean {
    return this.activeContexts.has(terminalId);
  }

  /**
   * Get statistics for debugging
   */
  getStats(): {
    isSupported: boolean;
    maxContexts: number;
    activeContexts: number;
    registeredTerminals: number;
    contextQueue: string[];
  } {
    return {
      isSupported: this.isSupported,
      maxContexts: this.MAX_CONTEXTS,
      activeContexts: this.activeContexts.size,
      registeredTerminals: this.terminals.size,
      contextQueue: [...this.contextQueue],
    };
  }

  /**
   * Force release all contexts (for debugging or emergency cleanup)
   */
  releaseAll(): void {
    console.warn('[WebGLContextManager] Releasing all contexts');
    const terminalIds = Array.from(this.activeContexts.keys());
    for (const id of terminalIds) {
      this.release(id);
    }
  }
}

/** Type alias for the manager — used by consumers that import lazily via dynamic import() */
export type WebGLContextManagerType = WebGLContextManager;

// Export singleton instance
export const webglContextManager = WebGLContextManager.getInstance();

// For debugging in browser console
if (typeof window !== 'undefined') {
  (window as Window & { __webglContextManager?: WebGLContextManager }).__webglContextManager = webglContextManager;
}

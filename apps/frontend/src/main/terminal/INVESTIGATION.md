# Investigation: pty.node SIGABRT Crash on macOS Shutdown

## Summary

The Electron app crashes with **SIGABRT (abort trap 6)** during shutdown on macOS. The root cause is a race condition between `@lydell/node-pty`'s native `ThreadSafeFunction` callbacks and Node.js environment teardown. PTY processes are killed without waiting for their exit, allowing native callbacks to fire after the JS environment has begun cleanup.

---

## 1. Root Cause Chain

```
User quits app
  → Electron fires 'before-quit' event
    → index.ts handler calls terminalManager.killAll()
      → destroyAllTerminals() calls PtyManager.killPty(terminal) (fire-and-forget, NO wait)
      → terminals.clear()
      → Function returns immediately
    → before-quit handler completes (async, but doesn't block quit)
  → Electron proceeds with shutdown
    → Node.js begins environment cleanup: node::Environment::CleanupHandles()
      → PTY native addon's ThreadSafeFunction callback fires
        → Calls Napi::Error::ThrowAsJavaScriptException()
        → C++ exception thrown via __cxa_throw during cleanup
        → Exception cannot be caught (environment is being destroyed)
        → libc++abi: terminating due to uncaught exception
          → abort() → SIGABRT
```

---

## 2. Code Evidence

### 2.1. `before-quit` handler does NOT block quit (index.ts:498-515)

```typescript
// Cleanup before quit
app.on('before-quit', async () => {
  // ...
  // Kill all terminal processes
  if (terminalManager) {
    await terminalManager.killAll();
  }
});
```

**Problem:** The `async` callback creates a Promise, but Electron's `before-quit` event does NOT await async handlers. The `await terminalManager.killAll()` is effectively fire-and-forget from Electron's perspective. The app proceeds to quit immediately regardless of whether `killAll()` has completed.

### 2.2. `destroyAllTerminals` does NOT wait for PTY exit (terminal-lifecycle.ts:299-332)

```typescript
export async function destroyAllTerminals(
  terminals: Map<string, TerminalProcess>,
  saveTimer: NodeJS.Timeout | null
): Promise<NodeJS.Timeout | null> {
  // ...
  terminals.forEach((terminal) => {
    promises.push(
      new Promise((resolve) => {
        try {
          // Note: We intentionally don't wait for PTY exit here
          PtyManager.killPty(terminal);  // <-- fire-and-forget kill signal
        } catch {
          // Ignore errors during cleanup
        }
        resolve();  // <-- resolves IMMEDIATELY, before PTY process has exited
      })
    );
  });

  await Promise.all(promises);  // <-- all promises resolve instantly
  terminals.clear();
  return saveTimer;
}
```

**Problem:** Each promise resolves synchronously right after calling `killPty()`. The comment says "Waiting would only delay shutdown unnecessarily." However, NOT waiting is what creates the race condition—PTY processes are still alive when the Node environment starts cleanup.

### 2.3. `killPty` without `waitForExit` is synchronous (pty-manager.ts:337-355)

```typescript
export function killPty(terminal: TerminalProcess, waitForExit?: boolean): Promise<void> | void {
  if (waitForExit) {
    // ... sets up exit promise and waits
    return exitPromise;
  }
  terminal.pty.kill();  // <-- just sends kill signal, returns immediately
}
```

**Key insight:** `destroyAllTerminals` calls `killPty(terminal)` without `waitForExit=true`, so it only sends SIGTERM to the PTY process. The PTY process is still running when `destroyAllTerminals` returns.

### 2.4. Contrast: `destroyTerminal` (single) DOES wait on Windows (terminal-lifecycle.ts:260-294)

```typescript
export async function destroyTerminal(/* ... */): Promise<TerminalOperationResult> {
  // ...
  if (isWindows()) {
    await PtyManager.killPty(terminal, true);  // <-- waits for exit
  } else {
    PtyManager.killPty(terminal);  // <-- fire-and-forget on Unix too
  }
  return { success: true };
}
```

The wait-for-exit pattern already exists for single terminal destruction on Windows, but is not applied to `destroyAllTerminals` on any platform.

### 2.5. PTY event handlers have no shutdown guard (pty-manager.ts:176-227)

```typescript
export function setupPtyHandlers(/* ... */): void {
  const { id, pty: ptyProcess } = terminal;

  ptyProcess.onData((data) => {
    // No shutdown check — will attempt to access JS objects during teardown
    terminal.outputBuffer = (terminal.outputBuffer + data).slice(-100000);
    onDataCallback(terminal, data);
    const win = getWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.TERMINAL_OUTPUT, id, data);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    // No shutdown check — will attempt to send IPC and access JS environment
    const win = getWindow();
    if (win) {
      win.webContents.send(IPC_CHANNELS.TERMINAL_EXIT, id, exitCode);
    }
    onExitCallback(terminal);
    if (terminals.get(id) === terminal) {
      terminals.delete(id);
    }
  });
}
```

**Problem:** Neither `onData` nor `onExit` check if the app is shutting down. When PTY processes receive SIGTERM and start dying, their native callbacks (delivered via `ThreadSafeFunction`) fire during or after Node.js environment teardown, triggering the crash.

---

## 3. Race Window Timeline

```
Time  Event                                              Thread
────  ─────────────────────────────────────────────────  ─────────
T0    User clicks Quit / Cmd+Q                           Main
T1    'before-quit' fires                                Main
T2    killAll() → destroyAllTerminals()                  Main
T3    killPty(terminal) sends SIGTERM to each PTY        Main
T4    destroyAllTerminals() returns (promises resolved)  Main
T5    before-quit handler returns                        Main
T6    Electron starts shutdown sequence                  Main
T7    Node.js begins Environment::CleanupHandles()       Main
T8    PTY process receives SIGTERM and begins dying       ← PTY (background)
T9    node-pty native addon queues ThreadSafeFunction     Native thread
T10   ThreadSafeFunction callback fires in main thread    Main
T11   Callback calls ThrowAsJavaScriptException()         Main
T12   C++ exception thrown during environment cleanup     Main
T13   Exception is uncatchable → abort() → SIGABRT        Main

┌─────────────────────────────────────────────────────────┐
│  RACE WINDOW: T5 → T7                                   │
│  Between: before-quit returns and env cleanup starts     │
│  PTY processes are still alive, callbacks still active   │
│  Duration: typically < 100ms, but enough for the crash   │
└─────────────────────────────────────────────────────────┘
```

The core issue is that between T3 (kill signal sent) and T8-T9 (PTY processes dying and firing callbacks), the Node.js environment has already entered its cleanup phase (T7). The native addon's `ThreadSafeFunction` doesn't know the environment is being torn down and attempts to throw a JS exception, which is fatal during cleanup.

---

## 4. Contributing Factors

1. **Electron ignores async `before-quit` handlers.** The `async` keyword on the handler is misleading—Electron fires the event synchronously and does not await the returned Promise.

2. **`destroyAllTerminals` is optimized for speed, not safety.** The comment "Waiting would only delay shutdown unnecessarily" is incorrect—it's the fire-and-forget behavior that causes the SIGABRT.

3. **No shutdown guard in PTY callbacks.** Unlike `pty-daemon-client.ts` which has an `isShuttingDown` flag, `pty-manager.ts` has no such guard for its event handlers.

4. **macOS is most affected** because PTY process termination timing differs from Windows/Linux. On Windows, the wait-for-exit pattern is already applied in `destroyTerminal()`, and Windows shutdown is more tolerant of pending callbacks.

---

## 5. Proposed Fix Strategy

### Fix 1: Add shutdown flag to pty-manager.ts

Add a module-level `isShuttingDown` flag (matching the pattern in `pty-daemon-client.ts`). Guard all PTY event handlers (`onData`, `onExit`) to early-return when the flag is set. The `onExit` handler must still resolve `pendingExitPromises` during shutdown so that wait-for-exit works.

### Fix 2: Make `destroyAllTerminals` wait for PTY exit

Change `PtyManager.killPty(terminal)` to `PtyManager.killPty(terminal, true)` for all terminals. Add a global timeout (3 seconds) via `Promise.race` to prevent infinite hang if PTY processes don't respond. Set the shutdown flag BEFORE sending kill signals.

### Fix 3: Use `event.preventDefault()` in `before-quit`

Since Electron doesn't await async `before-quit` handlers, use the established pattern:
1. Call `event.preventDefault()` to block the quit
2. Perform async cleanup (including waiting for PTY exit)
3. Call `app.quit()` to re-trigger quit after cleanup
4. Use a re-entrancy guard (`isQuitting`) to prevent infinite loop

### Fix 4: Harden PTY daemon shutdown

Add shutdown guards to `pty-daemon.ts` to prevent spawning new PTYs during shutdown. Add try/catch wrappers in daemon signal handlers to handle edge cases.

### Priority Order

Fix 1 + Fix 2 together resolve the core race condition. Fix 3 ensures the async cleanup actually completes before Electron proceeds. Fix 4 is defense-in-depth.

---

## 6. Existing Patterns to Reuse

| Pattern | Location | Reuse |
|---------|----------|-------|
| `waitForPtyExit()` with timeout | `pty-manager.ts:57-71` | Use for shutdown wait in `destroyAllTerminals` |
| `pendingExitPromises` Map | `pty-manager.ts:40-43` | Already resolves in `onExit` handler |
| `isShuttingDown` flag | `pty-daemon-client.ts:403` | Copy pattern for `pty-manager.ts` |
| `killPty(terminal, true)` overload | `pty-manager.ts:335-336` | Already exists, just need to use it |
| `event.preventDefault()` pattern | Electron best practices | Apply to `before-quit` handler |

---

## 7. Risk Assessment

- **Fix scope:** 3 files modified (`pty-manager.ts`, `terminal-lifecycle.ts`, `index.ts`) + 2 hardened (`pty-daemon.ts`, `pty-daemon-client.ts`)
- **Regression risk:** Low — changes are additive guards and waits, no logic removal
- **Platform impact:** All platforms benefit; macOS crash is eliminated; Windows/Linux get improved shutdown reliability
- **Shutdown time impact:** Up to 3 seconds added (timeout bound) in worst case; typically < 500ms on Unix

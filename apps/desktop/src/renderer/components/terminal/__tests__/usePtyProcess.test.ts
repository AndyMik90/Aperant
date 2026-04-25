/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for usePtyProcess
 *
 * Covers the guard that prevents PTY creation when a terminal has exited
 * naturally (status === 'exited'), which was causing an infinite
 * mount → create PTY → unmount → mount loop via the TerminalGrid
 * pendingCleanup grace-period mechanism.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { usePtyProcess } from '../usePtyProcess';
import type { TerminalStatus } from '../../../stores/terminal-store';

const mockCreateTerminal = vi.fn();
const mockDestroyTerminal = vi.fn();
const mockRestoreTerminalSession = vi.fn();

vi.stubGlobal('window', {
  electronAPI: {
    createTerminal: mockCreateTerminal,
    destroyTerminal: mockDestroyTerminal,
    restoreTerminalSession: mockRestoreTerminalSession,
  },
});

/** Mutable terminal state controlled per test */
let mockTerminalStatus: TerminalStatus = 'idle';
let mockIsRestored: boolean = false;

const mockSetTerminalStatus = vi.fn();
const mockGetTerminal = vi.fn();

vi.mock('../../../stores/terminal-store', () => ({
  useTerminalStore: Object.assign(vi.fn(), {
    getState: () => ({
      terminals: [
        {
          id: 'term-1',
          status: mockTerminalStatus,
          isRestored: mockIsRestored,
          isCLIMode: false,
          cwd: '/test',
        },
      ],
      setTerminalStatus: mockSetTerminalStatus,
      getTerminal: mockGetTerminal,
    }),
  }),
}));

const DEFAULT_OPTIONS = {
  terminalId: 'term-1',
  cwd: '/test',
  projectPath: '/test',
  cols: 80,
  rows: 24,
  skipCreation: false,
} as const;

describe('usePtyProcess — exited-terminal guard (#fix/terminal-exit-pty-recreation-loop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTerminalStatus = 'idle';
    mockIsRestored = false;
    mockCreateTerminal.mockResolvedValue({ success: true });
    mockDestroyTerminal.mockResolvedValue({ success: true });
  });

  it('does not call createTerminal when terminal status is exited (natural exit)', async () => {
    mockTerminalStatus = 'exited';

    await act(async () => {
      renderHook(() => usePtyProcess(DEFAULT_OPTIONS));
    });

    expect(mockCreateTerminal).not.toHaveBeenCalled();
  });

  it('does not call createTerminal on repeated mounts when status remains exited', async () => {
    mockTerminalStatus = 'exited';

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        const { unmount } = renderHook(() => usePtyProcess(DEFAULT_OPTIONS));
        unmount();
      });
    }

    expect(mockCreateTerminal).not.toHaveBeenCalled();
    expect(mockDestroyTerminal).not.toHaveBeenCalled();
  });

  it('allows PTY creation when status is exited but isRecreatingRef is true (worktree switch)', async () => {
    mockTerminalStatus = 'exited';

    await act(async () => {
      renderHook(() => {
        const isRecreatingRef = useRef(true);
        return usePtyProcess({ ...DEFAULT_OPTIONS, isRecreatingRef });
      });
    });

    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);
    // The recreation path resets status from 'exited' → 'idle' before creating the PTY
    expect(mockSetTerminalStatus).toHaveBeenCalledWith('term-1', 'idle');
  });

  it('calls createTerminal when terminal status is idle', async () => {
    mockTerminalStatus = 'idle';

    await act(async () => {
      renderHook(() => usePtyProcess(DEFAULT_OPTIONS));
    });

    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);
    expect(mockCreateTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'term-1', cwd: '/test', cols: 80, rows: 24 }),
    );
  });

  it('calls createTerminal when terminal status is running (e.g. reconnect)', async () => {
    mockTerminalStatus = 'running';

    await act(async () => {
      renderHook(() => usePtyProcess(DEFAULT_OPTIONS));
    });

    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);
  });

  it('does not call createTerminal when skipCreation is true', async () => {
    mockTerminalStatus = 'idle';

    await act(async () => {
      renderHook(() => usePtyProcess({ ...DEFAULT_OPTIONS, skipCreation: true }));
    });

    expect(mockCreateTerminal).not.toHaveBeenCalled();
  });
});

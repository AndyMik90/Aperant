/**
 * Agent Drift Store
 *
 * Zustand store for managing drift monitoring state in the frontend.
 * Tracks drift reports, settings, and real-time updates from the backend.
 */

import { create } from 'zustand';
import { IPC_CHANNELS } from '../../shared/constants';
import type { IPCResult } from '../../shared/types';

// Drift report structure (matches Python DriftReport.to_dict())
export interface DriftReport {
  run_id: string;
  timestamp: string;
  overall_drift_score: number;
  component_scores: Record<string, number>;
  anomalies: string[];
  alert_level: 'normal' | 'warning' | 'critical';
  is_interim?: boolean;
  tool_count?: number;
  session_duration_ms?: number;
  recent_tools?: Array<{ tool: string; time: number; success: boolean }>;
  baseline_info?: BaselineInfo;
}

// Baseline info structure
export interface BaselineInfo {
  exists: boolean;
  created_at?: string;
  updated_at?: string;
  run_count?: number;
  historical_count?: number;
  tool_count?: number;
  tools?: string[];
  poisoning_warning?: boolean;
}

// Drift settings
export interface DriftSettings {
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  showBadge: boolean;
  showAlertBanner: boolean;
}

// Per-task drift state
interface TaskDriftState {
  report: DriftReport | null;
  baseline: BaselineInfo | null;
  loading: boolean;
  error: string | null;
}

interface DriftState {
  // Per-task drift data (keyed by taskId)
  taskDrift: Map<string, TaskDriftState>;

  // Global settings
  settings: DriftSettings;
  settingsLoading: boolean;

  // Alert state (for banner)
  activeAlerts: Array<{
    taskId: string;
    level: 'warning' | 'critical';
    score: number;
    anomalies: string[];
    timestamp: number;
  }>;

  // Actions
  loadDriftReport: (taskId: string, specDir: string) => Promise<void>;
  loadBaseline: (taskId: string, specDir: string) => Promise<void>;
  resetBaseline: (taskId: string, specDir: string) => Promise<void>;
  loadSettings: (projectDir: string) => Promise<void>;
  saveSettings: (projectDir: string, settings: Partial<DriftSettings>) => Promise<void>;
  updateDriftReport: (taskId: string, report: DriftReport) => void;
  updateInterimReport: (taskId: string, report: DriftReport) => void;
  addAlert: (taskId: string, level: 'warning' | 'critical', score: number, anomalies: string[]) => void;
  dismissAlert: (taskId: string) => void;
  clearTaskDrift: (taskId: string) => void;
}

const DEFAULT_SETTINGS: DriftSettings = {
  enabled: true,
  warningThreshold: 0.3,
  criticalThreshold: 0.5,
  showBadge: true,
  showAlertBanner: true,
};

export const useDriftStore = create<DriftState>((set, get) => ({
  taskDrift: new Map(),
  settings: DEFAULT_SETTINGS,
  settingsLoading: false,
  activeAlerts: [],

  loadDriftReport: async (taskId: string, specDir: string) => {
    // Set loading state
    set((state) => {
      const newMap = new Map(state.taskDrift);
      const current = newMap.get(taskId) || {
        report: null,
        baseline: null,
        loading: false,
        error: null,
      };
      newMap.set(taskId, { ...current, loading: true, error: null });
      return { taskDrift: newMap };
    });

    try {
      const result = await window.electronAPI.invoke<IPCResult<DriftReport | null>>(
        IPC_CHANNELS.DRIFT_GET_REPORT,
        specDir
      );

      set((state) => {
        const newMap = new Map(state.taskDrift);
        const current = newMap.get(taskId) || {
          report: null,
          baseline: null,
          loading: false,
          error: null,
        };
        if (result.success) {
          newMap.set(taskId, {
            ...current,
            report: result.data ?? null,
            loading: false,
          });
        } else {
          newMap.set(taskId, {
            ...current,
            loading: false,
            error: result.error || 'Failed to load drift report',
          });
        }
        return { taskDrift: newMap };
      });
    } catch (error) {
      set((state) => {
        const newMap = new Map(state.taskDrift);
        const current = newMap.get(taskId) || {
          report: null,
          baseline: null,
          loading: false,
          error: null,
        };
        newMap.set(taskId, {
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return { taskDrift: newMap };
      });
    }
  },

  loadBaseline: async (taskId: string, specDir: string) => {
    try {
      const result = await window.electronAPI.invoke<IPCResult<BaselineInfo>>(
        IPC_CHANNELS.DRIFT_GET_BASELINE,
        specDir
      );

      if (result.success && result.data) {
        set((state) => {
          const newMap = new Map(state.taskDrift);
          const current = newMap.get(taskId) || {
            report: null,
            baseline: null,
            loading: false,
            error: null,
          };
          newMap.set(taskId, { ...current, baseline: result.data ?? null });
          return { taskDrift: newMap };
        });
      }
    } catch (error) {
      console.error('[drift-store] Failed to load baseline:', error);
    }
  },

  resetBaseline: async (taskId: string, specDir: string) => {
    try {
      const result = await window.electronAPI.invoke<IPCResult<void>>(
        IPC_CHANNELS.DRIFT_RESET_BASELINE,
        specDir
      );

      if (result.success) {
        // Reload baseline info after reset
        await get().loadBaseline(taskId, specDir);
      }
    } catch (error) {
      console.error('[drift-store] Failed to reset baseline:', error);
    }
  },

  loadSettings: async (projectDir: string) => {
    set({ settingsLoading: true });

    try {
      const result = await window.electronAPI.invoke<IPCResult<DriftSettings>>(
        IPC_CHANNELS.DRIFT_GET_SETTINGS,
        projectDir
      );

      if (result.success && result.data) {
        set({ settings: result.data, settingsLoading: false });
      } else {
        set({ settingsLoading: false });
      }
    } catch (error) {
      console.error('[drift-store] Failed to load settings:', error);
      set({ settingsLoading: false });
    }
  },

  saveSettings: async (projectDir: string, settings: Partial<DriftSettings>) => {
    try {
      const result = await window.electronAPI.invoke<IPCResult<void>>(
        IPC_CHANNELS.DRIFT_SAVE_SETTINGS,
        projectDir,
        settings
      );

      if (result.success) {
        set((state) => ({
          settings: { ...state.settings, ...settings },
        }));
      }
    } catch (error) {
      console.error('[drift-store] Failed to save settings:', error);
    }
  },

  updateDriftReport: (taskId: string, report: DriftReport) => {
    set((state) => {
      const newMap = new Map(state.taskDrift);
      const current = newMap.get(taskId) || {
        report: null,
        baseline: null,
        loading: false,
        error: null,
      };
      newMap.set(taskId, { ...current, report });
      return { taskDrift: newMap };
    });
  },

  updateInterimReport: (taskId: string, report: DriftReport) => {
    // Only update if it's newer (interim reports are for real-time display)
    set((state) => {
      const newMap = new Map(state.taskDrift);
      const current = newMap.get(taskId) || {
        report: null,
        baseline: null,
        loading: false,
        error: null,
      };

      // Only update if we don't have a final report yet
      if (!current.report || current.report.is_interim) {
        newMap.set(taskId, { ...current, report });
        return { taskDrift: newMap };
      }

      return state;
    });
  },

  addAlert: (
    taskId: string,
    level: 'warning' | 'critical',
    score: number,
    anomalies: string[]
  ) => {
    set((state) => {
      // Don't add duplicate alerts for the same task
      if (state.activeAlerts.some((a) => a.taskId === taskId)) {
        return state;
      }

      return {
        activeAlerts: [
          ...state.activeAlerts,
          {
            taskId,
            level,
            score,
            anomalies,
            timestamp: Date.now(),
          },
        ],
      };
    });
  },

  dismissAlert: (taskId: string) => {
    set((state) => ({
      activeAlerts: state.activeAlerts.filter((a) => a.taskId !== taskId),
    }));
  },

  clearTaskDrift: (taskId: string) => {
    set((state) => {
      const newMap = new Map(state.taskDrift);
      newMap.delete(taskId);
      return {
        taskDrift: newMap,
        activeAlerts: state.activeAlerts.filter((a) => a.taskId !== taskId),
      };
    });
  },
}));

/**
 * Hook to get drift data for a specific task
 */
export function useTaskDrift(taskId: string): TaskDriftState | null {
  return useDriftStore((state) => state.taskDrift.get(taskId) || null);
}

/**
 * Hook to get drift alert level for badge display
 */
export function useDriftAlertLevel(
  taskId: string
): 'normal' | 'warning' | 'critical' | null {
  const taskDrift = useDriftStore((state) => state.taskDrift.get(taskId));
  const settings = useDriftStore((state) => state.settings);

  if (!settings.enabled || !settings.showBadge) {
    return null;
  }

  return taskDrift?.report?.alert_level || null;
}

/**
 * Setup IPC listeners for drift events
 * Call this once when the app starts
 */
export function setupDriftListeners(): () => void {
  const store = useDriftStore.getState();

  // Listen for drift report updates
  const removeReportListener = window.electronAPI.on(
    IPC_CHANNELS.DRIFT_REPORT_UPDATED,
    (_event: unknown, ...args: unknown[]) => {
      const data = args[0] as { taskId: string; report: DriftReport };
      if (data && data.taskId && data.report) {
        store.updateDriftReport(data.taskId, data.report);
      }
    }
  );

  // Listen for interim reports
  const removeInterimListener = window.electronAPI.on(
    IPC_CHANNELS.DRIFT_INTERIM_REPORT,
    (_event: unknown, ...args: unknown[]) => {
      const data = args[0] as { taskId: string; report: DriftReport };
      if (data && data.taskId && data.report) {
        store.updateInterimReport(data.taskId, data.report);
      }
    }
  );

  // Listen for drift alerts
  const removeAlertListener = window.electronAPI.on(
    IPC_CHANNELS.DRIFT_ALERT,
    (_event: unknown, ...args: unknown[]) => {
      const data = args[0] as {
        taskId: string;
        level: 'warning' | 'critical';
        score: number;
        anomalies: string[];
      };
      if (data && data.taskId && data.level) {
        store.addAlert(data.taskId, data.level, data.score, data.anomalies);
      }
    }
  );

  // Return cleanup function
  return () => {
    removeReportListener();
    removeInterimListener();
    removeAlertListener();
  };
}

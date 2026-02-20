import { describe, it, expect } from 'vitest';
import {
  GENERATION_STATE_NAMES,
  FEATURE_STATE_NAMES,
  mapGenerationStateToPhase,
  mapFeatureStateToStatus,
} from '../roadmap-state-utils';
import { roadmapGenerationMachine } from '../roadmap-generation-machine';
import { roadmapFeatureMachine } from '../roadmap-feature-machine';

describe('mapGenerationStateToPhase', () => {
  it('should map every GENERATION_STATE_NAMES entry to a non-default phase', () => {
    for (const state of GENERATION_STATE_NAMES) {
      const phase = mapGenerationStateToPhase(state);
      // Each known state should map to itself (identity mapping), NOT the default 'idle'
      expect(phase).toBe(state);
    }
  });

  it('should map each generation state to a valid phase value', () => {
    const validPhases = new Set(['idle', 'analyzing', 'discovering', 'generating', 'complete', 'error']);
    for (const state of GENERATION_STATE_NAMES) {
      const phase = mapGenerationStateToPhase(state);
      expect(validPhases.has(phase)).toBe(true);
    }
  });

  it('should return idle for unknown states', () => {
    expect(mapGenerationStateToPhase('nonexistent')).toBe('idle');
    expect(mapGenerationStateToPhase('')).toBe('idle');
  });

  it('should have a case for every generation state (no silent fallthrough)', () => {
    // Verify that no known state falls through to the default case
    // by checking that each maps to its own name (identity)
    const defaultValue = mapGenerationStateToPhase('__unknown_sentinel__');
    for (const state of GENERATION_STATE_NAMES) {
      if (state === defaultValue) continue; // 'idle' is both a valid state and the default
      const result = mapGenerationStateToPhase(state);
      expect(result).not.toBe(defaultValue);
    }
  });

  it('should include every machine state in GENERATION_STATE_NAMES (reverse direction)', () => {
    const machineStates = Object.keys(roadmapGenerationMachine.config.states ?? {});
    const stateNameSet = new Set<string>(GENERATION_STATE_NAMES);
    for (const machineState of machineStates) {
      expect(stateNameSet.has(machineState), `Machine state '${machineState}' missing from GENERATION_STATE_NAMES`).toBe(true);
    }
  });
});

describe('mapFeatureStateToStatus', () => {
  it('should map every FEATURE_STATE_NAMES entry to a non-default status', () => {
    for (const state of FEATURE_STATE_NAMES) {
      const status = mapFeatureStateToStatus(state);
      // Each known state should map to itself (identity mapping), NOT the default 'under_review'
      expect(status).toBe(state);
    }
  });

  it('should map each feature state to a valid status value', () => {
    const validStatuses = new Set(['under_review', 'planned', 'in_progress', 'done']);
    for (const state of FEATURE_STATE_NAMES) {
      const status = mapFeatureStateToStatus(state);
      expect(validStatuses.has(status)).toBe(true);
    }
  });

  it('should return under_review for unknown states', () => {
    expect(mapFeatureStateToStatus('nonexistent')).toBe('under_review');
    expect(mapFeatureStateToStatus('')).toBe('under_review');
  });

  it('should have a case for every feature state (no silent fallthrough)', () => {
    // Verify that no known state falls through to the default case
    // by checking that each maps to its own name (identity)
    const defaultValue = mapFeatureStateToStatus('__unknown_sentinel__');
    for (const state of FEATURE_STATE_NAMES) {
      if (state === defaultValue) continue; // 'under_review' is both valid and default
      const result = mapFeatureStateToStatus(state);
      expect(result).not.toBe(defaultValue);
    }
  });

  it('should include every machine state in FEATURE_STATE_NAMES (reverse direction)', () => {
    const machineStates = Object.keys(roadmapFeatureMachine.config.states ?? {});
    const stateNameSet = new Set<string>(FEATURE_STATE_NAMES);
    for (const machineState of machineStates) {
      expect(stateNameSet.has(machineState), `Machine state '${machineState}' missing from FEATURE_STATE_NAMES`).toBe(true);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repairJson, safeParseJson } from '../json-repair';

// Suppress console.warn from repair logging during tests
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('repairJson', () => {
  it('returns valid JSON unchanged', () => {
    const valid = '{"key": "value", "arr": [1, 2, 3]}';
    expect(repairJson(valid)).toBe(valid);
  });

  it('repairs missing comma between array elements', () => {
    const broken = `{
  "subtasks": [
    {"id": "1.1", "status": "completed"}
    {"id": "1.2", "status": "pending"}
  ]
}`;
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.subtasks).toHaveLength(2);
    expect(parsed.subtasks[0].status).toBe('completed');
    expect(parsed.subtasks[1].status).toBe('pending');
  });

  it('repairs missing comma between object properties on separate lines', () => {
    const broken = `{
  "id": "1.1"
  "status": "completed"
}`;
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('1.1');
    expect(parsed.status).toBe('completed');
  });

  it('removes trailing commas', () => {
    const broken = '{"key": "value", "arr": [1, 2, 3,],}';
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.key).toBe('value');
    expect(parsed.arr).toEqual([1, 2, 3]);
  });

  it('strips markdown code fences', () => {
    const broken = '```json\n{"key": "value"}\n```';
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.key).toBe('value');
  });

  it('strips illegal control characters while preserving valid unicode', () => {
    const broken = '{"text": "entrepren\u000f\u000fr og skogeier \u00f8 \u00e6 \u00e5"}';
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.text).toBe('entreprenr og skogeier ø æ å');
  });

  it('handles the real-world implementation_plan.json missing comma bug', () => {
    // This is the actual pattern that caused the production bug
    const broken = `{
  "phases": [
    {
      "id": "phase-1",
      "subtasks": [
        {
          "id": "1.1",
          "status": "completed"
        }
        {
          "id": "1.2",
          "status": "pending"
        }
      ]
    }
  ]
}`;
    const result = repairJson(broken);
    const parsed = JSON.parse(result);
    expect(parsed.phases[0].subtasks).toHaveLength(2);
    expect(parsed.phases[0].subtasks[0].status).toBe('completed');
  });

  it('throws original error for unrepairable JSON', () => {
    const unrepairable = '{{{invalid';
    expect(() => repairJson(unrepairable)).toThrow(SyntaxError);
  });
});

describe('safeParseJson', () => {
  it('returns parsed object for valid JSON', () => {
    const result = safeParseJson<{ key: string }>('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('returns parsed object for repairable JSON', () => {
    const result = safeParseJson<{ a: number; b: number }>('{"a": 1\n"b": 2}');
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns parsed object when invalid control characters are present', () => {
    const result = safeParseJson<{ text: string }>('{"text": "entrepren\u000f\u000fr og ø"}');
    expect(result).toEqual({ text: 'entreprenr og ø' });
  });

  it('returns null for unrepairable JSON', () => {
    const result = safeParseJson('{{{invalid');
    expect(result).toBeNull();
  });
});

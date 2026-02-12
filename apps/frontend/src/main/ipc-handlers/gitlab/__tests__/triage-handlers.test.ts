/**
 * Unit tests for GitLab Triage handlers
 * Tests sanitization functions and triage logic
 */
import { describe, it, expect } from 'vitest';

// Types matching the handler's internal types
type GitLabTriageCategory =
  | 'bug'
  | 'feature'
  | 'documentation'
  | 'question'
  | 'duplicate'
  | 'spam'
  | 'feature_creep';

interface GitLabTriageResult {
  issueIid: number;
  category: GitLabTriageCategory;
  confidence: number;
  labelsToAdd: string[];
  labelsToRemove: string[];
  priority: 'high' | 'medium' | 'low';
  triagedAt: string;
  duplicateOf?: number;
  spamReason?: string;
  featureCreepReason?: string;
  comment?: string;
}

// Sanitization functions copied from the handler for testing
const TRIAGE_CATEGORIES: GitLabTriageCategory[] = [
  'bug',
  'feature',
  'documentation',
  'question',
  'duplicate',
  'spam',
  'feature_creep',
];

function sanitizeIssueIid(value: unknown): number | null {
  const issueIid = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(issueIid) || issueIid <= 0) {
    return null;
  }
  return issueIid;
}

function sanitizeCategory(value: unknown): GitLabTriageCategory {
  return TRIAGE_CATEGORIES.includes(value as GitLabTriageCategory)
    ? (value as GitLabTriageCategory)
    : 'feature';
}

function sanitizeLabels(values: string[]): string[] {
  return values
    .filter((v): v is string => typeof v === 'string')
    .slice(0, 50)
    .map((v) => v.slice(0, 50));
}

function sanitizeConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function sanitizePriority(value: unknown): 'high' | 'medium' | 'low' {
  if (value === 'high' || value === 'low') return value;
  return 'medium';
}

function sanitizeTriagedAt(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function sanitizeTriageResult(result: Partial<GitLabTriageResult>): {
  issue_iid: number;
  category: GitLabTriageCategory;
  confidence: number;
  labels_to_add: string[];
  labels_to_remove: string[];
  priority: 'high' | 'medium' | 'low';
  triaged_at: string;
} | null {
  const issueIid = sanitizeIssueIid(result.issueIid);
  if (!issueIid) return null;
  return {
    issue_iid: issueIid,
    category: sanitizeCategory(result.category),
    confidence: sanitizeConfidence(result.confidence ?? 0),
    labels_to_add: sanitizeLabels(result.labelsToAdd ?? []),
    labels_to_remove: sanitizeLabels(result.labelsToRemove ?? []),
    priority: sanitizePriority(result.priority),
    triaged_at: sanitizeTriagedAt(result.triagedAt),
  };
}

// Simple category detection logic from the handler
function detectCategory(title: string, description: string = ''): GitLabTriageCategory {
  const titleLower = title.toLowerCase();
  const descLower = description.toLowerCase();

  if (titleLower.includes('bug') || titleLower.includes('fix') || titleLower.includes('error')) {
    return 'bug';
  } else if (titleLower.includes('doc') || descLower.includes('documentation')) {
    return 'documentation';
  } else if (titleLower.includes('question') || titleLower.includes('?')) {
    return 'question';
  }
  return 'feature';
}

describe('GitLab Triage Handlers', () => {
  describe('sanitizeIssueIid', () => {
    it('should accept valid positive integers', () => {
      expect(sanitizeIssueIid(1)).toBe(1);
      expect(sanitizeIssueIid(100)).toBe(100);
      expect(sanitizeIssueIid(999999)).toBe(999999);
    });

    it('should parse string numbers', () => {
      expect(sanitizeIssueIid('42')).toBe(42);
      expect(sanitizeIssueIid('1')).toBe(1);
    });

    it('should reject zero', () => {
      expect(sanitizeIssueIid(0)).toBeNull();
    });

    it('should reject negative numbers', () => {
      expect(sanitizeIssueIid(-1)).toBeNull();
      expect(sanitizeIssueIid(-100)).toBeNull();
    });

    it('should reject non-integer numbers', () => {
      expect(sanitizeIssueIid(1.5)).toBeNull();
      expect(sanitizeIssueIid(3.14)).toBeNull();
    });

    it('should reject invalid strings', () => {
      expect(sanitizeIssueIid('abc')).toBeNull();
      expect(sanitizeIssueIid('')).toBeNull();
      expect(sanitizeIssueIid(null)).toBeNull();
      expect(sanitizeIssueIid(undefined)).toBeNull();
    });
  });

  describe('sanitizeCategory', () => {
    it('should accept valid categories', () => {
      expect(sanitizeCategory('bug')).toBe('bug');
      expect(sanitizeCategory('feature')).toBe('feature');
      expect(sanitizeCategory('documentation')).toBe('documentation');
      expect(sanitizeCategory('question')).toBe('question');
      expect(sanitizeCategory('duplicate')).toBe('duplicate');
      expect(sanitizeCategory('spam')).toBe('spam');
      expect(sanitizeCategory('feature_creep')).toBe('feature_creep');
    });

    it('should default to feature for invalid categories', () => {
      expect(sanitizeCategory('invalid')).toBe('feature');
      expect(sanitizeCategory('')).toBe('feature');
      expect(sanitizeCategory(null)).toBe('feature');
      expect(sanitizeCategory(undefined)).toBe('feature');
      expect(sanitizeCategory(123)).toBe('feature');
    });
  });

  describe('sanitizeLabels', () => {
    it('should return valid labels unchanged', () => {
      const labels = ['bug', 'priority::high', 'status::confirmed'];
      expect(sanitizeLabels(labels)).toEqual(labels);
    });

    it('should limit to 50 labels', () => {
      const labels = Array.from({ length: 60 }, (_, i) => `label-${i}`);
      const result = sanitizeLabels(labels);
      expect(result.length).toBe(50);
    });

    it('should truncate long labels to 50 chars', () => {
      const longLabel = 'a'.repeat(100);
      const result = sanitizeLabels([longLabel]);
      expect(result[0].length).toBe(50);
    });

    it('should filter out non-string values', () => {
      const mixed = ['valid', 123, null, undefined, 'also-valid'] as string[];
      const result = sanitizeLabels(mixed);
      expect(result).toEqual(['valid', 'also-valid']);
    });

    it('should handle empty arrays', () => {
      expect(sanitizeLabels([])).toEqual([]);
    });
  });

  describe('sanitizeConfidence', () => {
    it('should accept values between 0 and 1', () => {
      expect(sanitizeConfidence(0)).toBe(0);
      expect(sanitizeConfidence(0.5)).toBe(0.5);
      expect(sanitizeConfidence(1)).toBe(1);
    });

    it('should clamp values above 1', () => {
      expect(sanitizeConfidence(1.5)).toBe(1);
      expect(sanitizeConfidence(100)).toBe(1);
    });

    it('should clamp values below 0', () => {
      expect(sanitizeConfidence(-0.5)).toBe(0);
      expect(sanitizeConfidence(-100)).toBe(0);
    });

    it('should handle non-finite values', () => {
      expect(sanitizeConfidence(NaN)).toBe(0);
      expect(sanitizeConfidence(Infinity)).toBe(0);
      expect(sanitizeConfidence(-Infinity)).toBe(0);
    });
  });

  describe('sanitizePriority', () => {
    it('should accept valid priority values', () => {
      expect(sanitizePriority('high')).toBe('high');
      expect(sanitizePriority('low')).toBe('low');
    });

    it('should default to medium for invalid values', () => {
      expect(sanitizePriority('medium')).toBe('medium');
      expect(sanitizePriority('invalid')).toBe('medium');
      expect(sanitizePriority('')).toBe('medium');
      expect(sanitizePriority(null)).toBe('medium');
      expect(sanitizePriority(undefined)).toBe('medium');
    });
  });

  describe('sanitizeTriagedAt', () => {
    it('should accept valid ISO date strings', () => {
      const date = '2024-01-15T10:00:00Z';
      const result = sanitizeTriagedAt(date);
      // toISOString normalizes to include milliseconds
      expect(new Date(result).getTime()).toBe(new Date(date).getTime());
    });

    it('should return current date for invalid strings', () => {
      const before = new Date().getTime();
      const result = sanitizeTriagedAt('invalid');
      const after = new Date().getTime();
      const resultTime = new Date(result).getTime();
      expect(resultTime).toBeGreaterThanOrEqual(before);
      expect(resultTime).toBeLessThanOrEqual(after);
    });

    it('should return current date for non-string values', () => {
      const before = new Date().getTime();
      const result = sanitizeTriagedAt(null);
      const after = new Date().getTime();
      const resultTime = new Date(result).getTime();
      expect(resultTime).toBeGreaterThanOrEqual(before);
      expect(resultTime).toBeLessThanOrEqual(after);
    });
  });

  describe('sanitizeTriageResult', () => {
    it('should return null for invalid issue IID', () => {
      const result = sanitizeTriageResult({
        issueIid: 0,
        category: 'bug',
        confidence: 0.9,
        labelsToAdd: ['bug'],
        labelsToRemove: [],
        priority: 'high',
        triagedAt: '2024-01-15T10:00:00Z',
      });
      expect(result).toBeNull();
    });

    it('should sanitize all fields', () => {
      const result = sanitizeTriageResult({
        issueIid: 42,
        category: 'bug',
        confidence: 0.9,
        labelsToAdd: ['bug', 'priority::high'],
        labelsToRemove: ['needs-triage'],
        priority: 'high',
        triagedAt: '2024-01-15T10:00:00Z',
      });

      expect(result).toMatchObject({
        issue_iid: 42,
        category: 'bug',
        confidence: 0.9,
        labels_to_add: ['bug', 'priority::high'],
        labels_to_remove: ['needs-triage'],
        priority: 'high',
      });
      expect(result?.triaged_at).toBeDefined();
    });

    it('should apply defaults for missing fields', () => {
      const result = sanitizeTriageResult({
        issueIid: 1,
      });

      expect(result).toEqual({
        issue_iid: 1,
        category: 'feature',
        confidence: 0,
        labels_to_add: [],
        labels_to_remove: [],
        priority: 'medium',
        triaged_at: expect.any(String),
      });
    });
  });

  describe('detectCategory', () => {
    it('should detect bug from title keywords', () => {
      expect(detectCategory('Bug: Login fails')).toBe('bug');
      expect(detectCategory('Fix memory leak')).toBe('bug');
      expect(detectCategory('Error in calculation')).toBe('bug');
    });

    it('should detect documentation', () => {
      expect(detectCategory('Update docs for API')).toBe('documentation');
      expect(detectCategory('Feature request', 'Add documentation section')).toBe('documentation');
    });

    it('should detect question', () => {
      expect(detectCategory('How do I use this?')).toBe('question');
      expect(detectCategory('Question about auth')).toBe('question');
    });

    it('should default to feature', () => {
      expect(detectCategory('Add new login method')).toBe('feature');
      expect(detectCategory('Implement dark mode')).toBe('feature');
      expect(detectCategory('')).toBe('feature');
    });

    it('should prioritize bug over other categories', () => {
      // Bug detection comes first
      expect(detectCategory('Fix documentation bug')).toBe('bug');
    });
  });
});

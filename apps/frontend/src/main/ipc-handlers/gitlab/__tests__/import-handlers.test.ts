/**
 * Unit tests for GitLab Import handlers
 * Tests import result types and validation
 */
import { describe, it, expect } from 'vitest';

// Types matching the handler's types
interface GitLabImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors?: string[];
}

interface IPCResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Utility functions from the handler
function validateImportResult(result: GitLabImportResult): boolean {
  return (
    typeof result.success === 'boolean' &&
    typeof result.imported === 'number' &&
    typeof result.failed === 'number' &&
    result.imported >= 0 &&
    result.failed >= 0 &&
    (result.errors === undefined || Array.isArray(result.errors))
  );
}

function createImportResult(
  imported: number,
  failed: number,
  errors: string[] = []
): GitLabImportResult {
  const result: GitLabImportResult = {
    success: imported > 0,
    imported,
    failed,
  };

  if (errors.length > 0) {
    result.errors = errors;
  }

  return result;
}

function wrapInIPCResult<T>(data: T, success: boolean = true, error?: string): IPCResult<T> {
  const result: IPCResult<T> = { success };
  if (success && data !== undefined) {
    result.data = data;
  }
  if (error) {
    result.error = error;
  }
  return result;
}

function validateIssueIids(iids: unknown): number[] | null {
  if (!Array.isArray(iids)) return null;

  const validIids: number[] = [];
  for (const iid of iids) {
    const num = typeof iid === 'number' ? iid : Number(iid);
    if (Number.isInteger(num) && num > 0) {
      validIids.push(num);
    }
  }

  return validIids;
}

describe('GitLab Import Handlers', () => {
  describe('validateImportResult', () => {
    it('should validate correct import results', () => {
      const result: GitLabImportResult = {
        success: true,
        imported: 5,
        failed: 0,
      };

      expect(validateImportResult(result)).toBe(true);
    });

    it('should validate result with errors', () => {
      const result: GitLabImportResult = {
        success: true,
        imported: 3,
        failed: 2,
        errors: ['Failed to import #10', 'Failed to import #11'],
      };

      expect(validateImportResult(result)).toBe(true);
    });

    it('should reject result with negative imported count', () => {
      const result = {
        success: true,
        imported: -1,
        failed: 0,
      } as GitLabImportResult;

      expect(validateImportResult(result)).toBe(false);
    });

    it('should reject result with negative failed count', () => {
      const result = {
        success: true,
        imported: 0,
        failed: -1,
      } as GitLabImportResult;

      expect(validateImportResult(result)).toBe(false);
    });

    it('should reject result with non-array errors', () => {
      const result = {
        success: true,
        imported: 1,
        failed: 0,
        errors: 'not an array',
      } as unknown as GitLabImportResult;

      expect(validateImportResult(result)).toBe(false);
    });

    it('should validate empty import (0 imported, 0 failed)', () => {
      const result: GitLabImportResult = {
        success: false,
        imported: 0,
        failed: 0,
      };

      expect(validateImportResult(result)).toBe(true);
    });
  });

  describe('createImportResult', () => {
    it('should create result with imported issues', () => {
      const result = createImportResult(5, 0);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(5);
      expect(result.failed).toBe(0);
      expect(result.errors).toBeUndefined();
    });

    it('should create result with partial success', () => {
      const result = createImportResult(3, 2, ['Error 1', 'Error 2']);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(3);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should create failed result with all failures', () => {
      const result = createImportResult(0, 5, ['All failed']);

      expect(result.success).toBe(false);
      expect(result.imported).toBe(0);
      expect(result.failed).toBe(5);
    });

    it('should not include empty errors array', () => {
      const result = createImportResult(1, 0, []);

      expect(result.errors).toBeUndefined();
    });
  });

  describe('wrapInIPCResult', () => {
    it('should wrap data in successful IPC result', () => {
      const data: GitLabImportResult = { success: true, imported: 5, failed: 0 };
      const result = wrapInIPCResult(data);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(data);
      expect(result.error).toBeUndefined();
    });

    it('should create error IPC result', () => {
      const result = wrapInIPCResult(null, false, 'Something went wrong');

      expect(result.success).toBe(false);
      expect(result.data).toBeUndefined();
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('validateIssueIids', () => {
    it('should validate array of valid IIDs', () => {
      const iids = [1, 2, 3, 42, 100];
      const result = validateIssueIids(iids);

      expect(result).toEqual([1, 2, 3, 42, 100]);
    });

    it('should parse string numbers', () => {
      const iids = ['1', '42', '100'];
      const result = validateIssueIids(iids);

      expect(result).toEqual([1, 42, 100]);
    });

    it('should filter out invalid values', () => {
      const iids = [1, 'invalid', 2, null, 3, undefined, -5, 0, 4.5];
      const result = validateIssueIids(iids);

      // Only positive integers should remain
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return null for non-array input', () => {
      expect(validateIssueIids(null)).toBeNull();
      expect(validateIssueIids(undefined)).toBeNull();
      expect(validateIssueIids('1,2,3')).toBeNull();
      expect(validateIssueIids(123)).toBeNull();
    });

    it('should return empty array for all invalid values', () => {
      const result = validateIssueIids(['a', 'b', null, undefined]);
      expect(result).toEqual([]);
    });

    it('should handle mixed valid and invalid', () => {
      const iids = [1, 'abc', 2, -1, '3', 0, 4];
      const result = validateIssueIids(iids);

      expect(result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Import Scenarios', () => {
    it('should handle successful import of all issues', () => {
      const issueIids = [1, 2, 3];
      const imported = issueIids.length;
      const result = createImportResult(imported, 0);

      expect(result.success).toBe(true);
      expect(result.imported).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('should handle partial import failure', () => {
      const total = 5;
      const succeeded = 3;
      const failed = total - succeeded;
      const errors = ['Issue #4 not found', 'Issue #5 access denied'];

      const result = createImportResult(succeeded, failed, errors);

      expect(result.success).toBe(true); // At least one succeeded
      expect(result.imported).toBe(3);
      expect(result.failed).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should handle complete failure', () => {
      const result = createImportResult(0, 3, ['All issues failed to import']);

      expect(result.success).toBe(false);
      expect(result.imported).toBe(0);
      expect(result.failed).toBe(3);
    });

    it('should handle empty IID list', () => {
      const iids: number[] = [];
      const validIids = validateIssueIids(iids);

      expect(validIids).toEqual([]);
    });
  });

  describe('IPC Result Distinction', () => {
    it('should distinguish transport success from operation success', () => {
      // IPC transport succeeded but no issues were imported
      const ipcResult = wrapInIPCResult({
        success: false, // Operation failed (0 imported)
        imported: 0,
        failed: 5,
        errors: ['All failed'],
      }, true);

      expect(ipcResult.success).toBe(true); // Transport OK
      expect(ipcResult.data?.success).toBe(false); // Operation failed
    });

    it('should show partial success correctly', () => {
      const ipcResult = wrapInIPCResult({
        success: true, // At least one imported
        imported: 2,
        failed: 1,
        errors: ['Issue #3 failed'],
      }, true);

      expect(ipcResult.success).toBe(true);
      expect(ipcResult.data?.success).toBe(true);
    });
  });
});

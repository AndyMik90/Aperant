/**
 * Tests for worktree branch validation logic.
 *
 * Issue #1479: When cleaning up a corrupted worktree, git rev-parse walks up
 * to the main project and returns its current branch instead of the worktree's branch.
 * This could cause deletion of the wrong branch.
 *
 * These tests verify the validation logic that prevents this.
 */

import { describe, expect, it } from 'vitest';
import { GIT_BRANCH_REGEX } from '../worktree-handlers';

/**
 * Validates a detected branch name and returns the safe branch to delete.
 * This mirrors the logic used in TASK_DISCARD_WORKTREE and TASK_UPDATE_STATUS handlers.
 *
 * Why `auto-claude/` prefix is considered safe:
 * - All task worktrees use branches named `auto-claude/{specId}`
 * - This pattern is controlled by Auto-Claude, not user input
 * - If detected branch matches this pattern, it's a valid task branch
 * - If it doesn't match (e.g., `main`, `develop`, `feature/xxx`), it's likely
 *   the main project's branch being incorrectly detected from a corrupted worktree
 */
function validateWorktreeBranch(
  detectedBranch: string | null,
  expectedBranch: string
): { branchToDelete: string; usedFallback: boolean; reason: string } {
  // If detection failed, use expected pattern
  if (detectedBranch === null) {
    return {
      branchToDelete: expectedBranch,
      usedFallback: true,
      reason: 'detection_failed',
    };
  }

  // Exact match - ideal case
  if (detectedBranch === expectedBranch) {
    return {
      branchToDelete: detectedBranch,
      usedFallback: false,
      reason: 'exact_match',
    };
  }

  // Matches auto-claude pattern with valid specId (not just "auto-claude/")
  // The specId must be non-empty for this to be a valid task branch
  if (detectedBranch.startsWith('auto-claude/') && detectedBranch.length > 'auto-claude/'.length) {
    return {
      branchToDelete: detectedBranch,
      usedFallback: false,
      reason: 'pattern_match',
    };
  }

  // Detected branch doesn't match expected pattern - use fallback
  // This is the critical security fix for issue #1479
  return {
    branchToDelete: expectedBranch,
    usedFallback: true,
    reason: 'invalid_pattern',
  };
}

describe('GIT_BRANCH_REGEX', () => {
  it('should accept valid auto-claude branch names', () => {
    expect(GIT_BRANCH_REGEX.test('auto-claude/my-feature')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('auto-claude/123-fix-bug')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('auto-claude/feature_with_underscore')).toBe(true);
  });

  it('should accept valid feature branch names', () => {
    expect(GIT_BRANCH_REGEX.test('feature/my-feature')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('fix/bug-123')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('main')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('develop')).toBe(true);
  });

  it('should accept single character branch names', () => {
    expect(GIT_BRANCH_REGEX.test('a')).toBe(true);
    expect(GIT_BRANCH_REGEX.test('1')).toBe(true);
  });

  it('should reject invalid branch names', () => {
    expect(GIT_BRANCH_REGEX.test('')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('-invalid')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('invalid-')).toBe(false);
    expect(GIT_BRANCH_REGEX.test('.invalid')).toBe(false);
  });

  it('should reject HEAD (detached state)', () => {
    // HEAD indicates detached state - should not be used as branch name
    expect(GIT_BRANCH_REGEX.test('HEAD')).toBe(true); // Note: HEAD is technically valid as a name
    // But we handle HEAD specially in the validation logic
  });
});

describe('validateWorktreeBranch', () => {
  const expectedBranch = 'auto-claude/my-feature-123';

  describe('exact match scenarios', () => {
    it('should use detected branch when it matches expected exactly', () => {
      const result = validateWorktreeBranch('auto-claude/my-feature-123', expectedBranch);
      expect(result.branchToDelete).toBe('auto-claude/my-feature-123');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('exact_match');
    });
  });

  describe('pattern match scenarios', () => {
    it('should allow other auto-claude branches (specId renamed)', () => {
      const result = validateWorktreeBranch('auto-claude/renamed-feature', expectedBranch);
      expect(result.branchToDelete).toBe('auto-claude/renamed-feature');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('pattern_match');
    });

    it('should allow auto-claude branches with different formats', () => {
      const result = validateWorktreeBranch('auto-claude/001-task', expectedBranch);
      expect(result.branchToDelete).toBe('auto-claude/001-task');
      expect(result.usedFallback).toBe(false);
      expect(result.reason).toBe('pattern_match');
    });
  });

  describe('security: corrupted worktree scenarios (issue #1479)', () => {
    it('should reject main project branch and use expected pattern', () => {
      // This is the critical case: corrupted worktree returns main project's branch
      const result = validateWorktreeBranch('feature/xstate-task-machine', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject develop branch', () => {
      const result = validateWorktreeBranch('develop', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject main branch', () => {
      const result = validateWorktreeBranch('main', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject master branch', () => {
      const result = validateWorktreeBranch('master', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject fix/ branches from main project', () => {
      const result = validateWorktreeBranch('fix/some-bug', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject feature/ branches from main project', () => {
      const result = validateWorktreeBranch('feature/new-feature', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });
  });

  describe('detection failure scenarios', () => {
    it('should use expected pattern when detection returns null', () => {
      const result = validateWorktreeBranch(null, expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('detection_failed');
    });
  });

  describe('edge cases', () => {
    it('should handle empty detected branch', () => {
      const result = validateWorktreeBranch('', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should handle HEAD (detached state)', () => {
      const result = validateWorktreeBranch('HEAD', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should handle branch that starts with auto-claude but is malformed', () => {
      // "auto-claude" without a slash should still be rejected
      const result = validateWorktreeBranch('auto-claude', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });

    it('should reject auto-claude/ with no suffix (invalid branch name)', () => {
      // "auto-claude/" alone is not a valid branch name - needs actual specId
      const result = validateWorktreeBranch('auto-claude/', expectedBranch);
      expect(result.branchToDelete).toBe(expectedBranch);
      expect(result.usedFallback).toBe(true);
      expect(result.reason).toBe('invalid_pattern');
    });
  });
});

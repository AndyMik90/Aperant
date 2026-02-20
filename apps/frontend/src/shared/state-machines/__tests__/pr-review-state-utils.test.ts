import { describe, it, expect } from 'vitest';
import {
  PR_REVIEW_STATE_NAMES,
  PR_REVIEW_SETTLED_STATES,
  mapPRReviewStateToLegacy,
} from '../pr-review-state-utils';

describe('pr-review-state-utils', () => {
  describe('PR_REVIEW_STATE_NAMES', () => {
    it('should contain all expected state names', () => {
      expect(PR_REVIEW_STATE_NAMES).toEqual([
        'idle', 'reviewing', 'externalReview', 'completed', 'error',
      ]);
    });
  });

  describe('PR_REVIEW_SETTLED_STATES', () => {
    it('should contain completed and error', () => {
      expect(PR_REVIEW_SETTLED_STATES.has('completed')).toBe(true);
      expect(PR_REVIEW_SETTLED_STATES.has('error')).toBe(true);
    });

    it('should not contain active states', () => {
      expect(PR_REVIEW_SETTLED_STATES.has('idle')).toBe(false);
      expect(PR_REVIEW_SETTLED_STATES.has('reviewing')).toBe(false);
      expect(PR_REVIEW_SETTLED_STATES.has('externalReview')).toBe(false);
    });
  });

  describe('mapPRReviewStateToLegacy', () => {
    it('should map idle to idle', () => {
      expect(mapPRReviewStateToLegacy('idle')).toBe('idle');
    });

    it('should map reviewing to reviewing', () => {
      expect(mapPRReviewStateToLegacy('reviewing')).toBe('reviewing');
    });

    it('should map externalReview to reviewing', () => {
      expect(mapPRReviewStateToLegacy('externalReview')).toBe('reviewing');
    });

    it('should map completed to completed', () => {
      expect(mapPRReviewStateToLegacy('completed')).toBe('completed');
    });

    it('should map error to error', () => {
      expect(mapPRReviewStateToLegacy('error')).toBe('error');
    });

    it('should map unknown states to idle', () => {
      expect(mapPRReviewStateToLegacy('unknown')).toBe('idle');
    });
  });
});

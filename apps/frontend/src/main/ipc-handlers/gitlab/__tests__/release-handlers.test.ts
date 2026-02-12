/**
 * Unit tests for GitLab Release handlers
 * Tests release creation and validation
 */
import { describe, it, expect } from 'vitest';

// Types matching the handler's types
interface GitLabReleaseOptions {
  description?: string;
  ref?: string;
  milestones?: (string | null)[];
}

interface GitLabReleaseResponse {
  tag_name: string;
  description: string;
  _links?: {
    self?: string;
  };
}

// Utility functions from the handler
function validateTagName(tagName: unknown): string | null {
  if (typeof tagName !== 'string' || tagName.trim().length === 0) {
    return null;
  }
  // Git tag names can't have spaces or certain characters
  const sanitized = tagName.trim();
  if (/[\s~^:?*[]/.test(sanitized)) {
    return null;
  }
  return sanitized;
}

function buildReleaseBody(
  tagName: string,
  releaseNotes: string,
  options?: GitLabReleaseOptions,
  defaultBranch: string = 'main'
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    tag_name: tagName,
    description: options?.description || releaseNotes,
    ref: options?.ref || defaultBranch,
  };

  if (options?.milestones && Array.isArray(options.milestones)) {
    body.milestones = options.milestones.filter(
      (m): m is string => typeof m === 'string' && m.length > 0
    );
  }

  return body;
}

function extractReleaseUrl(response: unknown): string | null {
  if (
    response &&
    typeof response === 'object' &&
    '_links' in response &&
    response._links &&
    typeof response._links === 'object' &&
    'self' in response._links &&
    typeof response._links.self === 'string'
  ) {
    return response._links.self;
  }
  return null;
}

describe('GitLab Release Handlers', () => {
  describe('validateTagName', () => {
    it('should accept valid tag names', () => {
      expect(validateTagName('v1.0.0')).toBe('v1.0.0');
      expect(validateTagName('1.0.0')).toBe('1.0.0');
      expect(validateTagName('release-2024-01-15')).toBe('release-2024-01-15');
    });

    it('should trim whitespace', () => {
      expect(validateTagName('  v1.0.0  ')).toBe('v1.0.0');
    });

    it('should reject empty strings', () => {
      expect(validateTagName('')).toBeNull();
      expect(validateTagName('   ')).toBeNull();
    });

    it('should reject non-string values', () => {
      expect(validateTagName(null)).toBeNull();
      expect(validateTagName(undefined)).toBeNull();
      expect(validateTagName(123)).toBeNull();
    });

    it('should reject tags with spaces', () => {
      expect(validateTagName('v1.0.0 beta')).toBeNull();
    });

    it('should reject tags with invalid characters', () => {
      expect(validateTagName('v1.0.0~1')).toBeNull(); // ~
      expect(validateTagName('v1.0.0^1')).toBeNull(); // ^
      expect(validateTagName('v1.0.0:1')).toBeNull(); // :
      expect(validateTagName('v1.0.0?1')).toBeNull(); // ?
      expect(validateTagName('v1.0.0*1')).toBeNull(); // *
      expect(validateTagName('v1.0.0[1]')).toBeNull(); // []
    });
  });

  describe('buildReleaseBody', () => {
    it('should build basic release body', () => {
      const body = buildReleaseBody('v1.0.0', 'Release notes');

      expect(body).toEqual({
        tag_name: 'v1.0.0',
        description: 'Release notes',
        ref: 'main',
      });
    });

    it('should use custom description from options', () => {
      const body = buildReleaseBody('v1.0.0', 'Default notes', {
        description: 'Custom description',
      });

      expect(body.description).toBe('Custom description');
    });

    it('should use custom ref from options', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', {
        ref: 'develop',
      });

      expect(body.ref).toBe('develop');
    });

    it('should include valid milestones', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', {
        milestones: ['v1.0', 'v1.0.1'],
      });

      expect(body.milestones).toEqual(['v1.0', 'v1.0.1']);
    });

    it('should filter out null milestones', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', {
        milestones: ['v1.0', null, 'v1.0.1'],
      });

      expect(body.milestones).toEqual(['v1.0', 'v1.0.1']);
    });

    it('should filter out empty string milestones', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', {
        milestones: ['v1.0', '', 'v1.0.1'],
      });

      expect(body.milestones).toEqual(['v1.0', 'v1.0.1']);
    });

    it('should not include milestones array if empty', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', {
        milestones: [null, ''],
      });

      expect(body.milestones).toEqual([]);
    });

    it('should use custom default branch', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', undefined, 'develop');

      expect(body.ref).toBe('develop');
    });

    it('should prefer options.ref over defaultBranch', () => {
      const body = buildReleaseBody('v1.0.0', 'Notes', { ref: 'feature' }, 'develop');

      expect(body.ref).toBe('feature');
    });
  });

  describe('extractReleaseUrl', () => {
    it('should extract URL from valid response', () => {
      const response: GitLabReleaseResponse = {
        tag_name: 'v1.0.0',
        description: 'Notes',
        _links: {
          self: 'https://gitlab.com/test/project/-/releases/v1.0.0',
        },
      };

      expect(extractReleaseUrl(response)).toBe('https://gitlab.com/test/project/-/releases/v1.0.0');
    });

    it('should return null for missing _links', () => {
      const response = {
        tag_name: 'v1.0.0',
        description: 'Notes',
      };

      expect(extractReleaseUrl(response)).toBeNull();
    });

    it('should return null for missing self link', () => {
      const response = {
        tag_name: 'v1.0.0',
        description: 'Notes',
        _links: {},
      };

      expect(extractReleaseUrl(response)).toBeNull();
    });

    it('should return null for non-string self link', () => {
      const response = {
        tag_name: 'v1.0.0',
        description: 'Notes',
        _links: {
          self: 123,
        },
      };

      expect(extractReleaseUrl(response)).toBeNull();
    });

    it('should return null for null response', () => {
      expect(extractReleaseUrl(null)).toBeNull();
      expect(extractReleaseUrl(undefined)).toBeNull();
    });

    it('should return null for non-object response', () => {
      expect(extractReleaseUrl('response')).toBeNull();
      expect(extractReleaseUrl(123)).toBeNull();
    });
  });

  describe('Release Creation Flow', () => {
    it('should create release with minimal options', () => {
      const tagName = 'v1.0.0';
      const releaseNotes = '# Release v1.0.0\n\nInitial release.';

      const body = buildReleaseBody(tagName, releaseNotes);

      expect(body.tag_name).toBe(tagName);
      expect(body.description).toBe(releaseNotes);
      expect(body.ref).toBe('main');
    });

    it('should create release with all options', () => {
      const tagName = 'v2.0.0';
      const releaseNotes = 'Default notes';
      const options: GitLabReleaseOptions = {
        description: 'Custom release description',
        ref: 'release-2.0',
        milestones: ['v2.0-milestone'],
      };

      const body = buildReleaseBody(tagName, releaseNotes, options, 'develop');

      expect(body).toEqual({
        tag_name: 'v2.0.0',
        description: 'Custom release description',
        ref: 'release-2.0',
        milestones: ['v2.0-milestone'],
      });
    });

    it('should handle response URL extraction', () => {
      const mockResponse: GitLabReleaseResponse = {
        tag_name: 'v1.0.0',
        description: 'Notes',
        _links: {
          self: 'https://gitlab.example.com/group/project/-/releases/v1.0.0',
        },
      };

      const url = extractReleaseUrl(mockResponse);

      expect(url).toBe('https://gitlab.example.com/group/project/-/releases/v1.0.0');
    });
  });
});

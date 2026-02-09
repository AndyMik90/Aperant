/**
 * Tests for profile-utils module
 */

import { describe, it, expect } from 'vitest';
import { isAPIProfileAuthenticated } from './profile-utils';
import type { APIProfile } from '../../shared/types';

describe('isAPIProfileAuthenticated', () => {
  it('should return true when both apiKey and baseUrl are present and non-empty', () => {
    const validProfile: APIProfile = {
      id: 'test-1',
      name: 'Test Profile',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'sk-ant-api03-test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(validProfile)).toBe(true);
  });

  it('should return false when apiKey is missing', () => {
    const profileWithoutApiKey: APIProfile = {
      id: 'test-2',
      name: 'Test Profile',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithoutApiKey)).toBe(false);
  });

  it('should return false when baseUrl is missing', () => {
    const profileWithoutBaseUrl: APIProfile = {
      id: 'test-3',
      name: 'Test Profile',
      baseUrl: '',
      apiKey: 'sk-ant-api03-test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithoutBaseUrl)).toBe(false);
  });

  it('should return false when apiKey is only whitespace', () => {
    const profileWithWhitespaceApiKey: APIProfile = {
      id: 'test-4',
      name: 'Test Profile',
      baseUrl: 'https://api.anthropic.com',
      apiKey: '   ',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithWhitespaceApiKey)).toBe(false);
  });

  it('should return false when baseUrl is only whitespace', () => {
    const profileWithWhitespaceBaseUrl: APIProfile = {
      id: 'test-5',
      name: 'Test Profile',
      baseUrl: '   ',
      apiKey: 'sk-ant-api03-test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithWhitespaceBaseUrl)).toBe(false);
  });

  it('should return false when both apiKey and baseUrl are missing', () => {
    const profileWithoutCredentials: APIProfile = {
      id: 'test-6',
      name: 'Test Profile',
      baseUrl: '',
      apiKey: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithoutCredentials)).toBe(false);
  });

  it('should return false when profile is undefined', () => {
    expect(isAPIProfileAuthenticated(undefined as any)).toBe(false);
  });

  it('should return false when profile is null', () => {
    expect(isAPIProfileAuthenticated(null as any)).toBe(false);
  });

  it('should handle profiles with apiKey and baseUrl containing leading/trailing whitespace', () => {
    const profileWithWhitespace: APIProfile = {
      id: 'test-7',
      name: 'Test Profile',
      baseUrl: '  https://api.anthropic.com  ',
      apiKey: '  sk-ant-api03-test  ',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    expect(isAPIProfileAuthenticated(profileWithWhitespace)).toBe(true);
  });
});

/**
 * Tests for provider detection utilities
 */

import { describe, it, expect } from 'vitest';
import { detectProvider, getProviderLabel, getProviderBadgeColor } from './provider-detection';

describe('provider-detection', () => {
  describe('detectProvider', () => {
    describe('Anthropic provider', () => {
      it('should detect Anthropic from api.anthropic.com', () => {
        const result = detectProvider('https://api.anthropic.com');
        expect(result).toBe('anthropic');
      });

      it('should detect Anthropic with path', () => {
        const result = detectProvider('https://api.anthropic.com/v1/messages');
        expect(result).toBe('anthropic');
      });

      it('should handle subdomain of Anthropic correctly', () => {
        const result = detectProvider('https://sub.api.anthropic.com');
        expect(result).toBe('anthropic');
      });
    });

    describe('z.ai provider', () => {
      it('should detect z.ai from api.z.ai', () => {
        const result = detectProvider('https://api.z.ai/api/anthropic');
        expect(result).toBe('zai');
      });

      it('should detect z.ai from z.ai domain', () => {
        const result = detectProvider('https://z.ai/api/anthropic');
        expect(result).toBe('zai');
      });
    });

    describe('ZHIPU provider', () => {
      it('should detect ZHIPU from open.bigmodel.cn', () => {
        const result = detectProvider('https://open.bigmodel.cn/api/anthropic');
        expect(result).toBe('zhipu');
      });

      it('should detect ZHIPU from dev.bigmodel.cn', () => {
        const result = detectProvider('https://dev.bigmodel.cn/api/paas/v4');
        expect(result).toBe('zhipu');
      });

      it('should detect ZHIPU from bigmodel.cn', () => {
        const result = detectProvider('https://bigmodel.cn/api/paas/v4');
        expect(result).toBe('zhipu');
      });
    });

    describe('Unknown provider', () => {
      it('should return unknown for unrecognized domain', () => {
        const result = detectProvider('https://unknown.com/api');
        expect(result).toBe('unknown');
      });

      it('should handle invalid URL gracefully', () => {
        const result = detectProvider('not-a-url');
        expect(result).toBe('unknown');
      });
    });
  });

  describe('getProviderLabel', () => {
    it('should return correct label for Anthropic', () => {
      expect(getProviderLabel('anthropic')).toBe('Anthropic');
    });

    it('should return correct label for z.ai', () => {
      expect(getProviderLabel('zai')).toBe('z.ai');
    });

    it('should return correct label for ZHIPU', () => {
      expect(getProviderLabel('zhipu')).toBe('ZHIPU AI');
    });

    it('should return Unknown for unknown provider', () => {
      expect(getProviderLabel('unknown')).toBe('Unknown');
    });
  });

  describe('getProviderBadgeColor', () => {
    it('should return orange colors for Anthropic', () => {
      const color = getProviderBadgeColor('anthropic');
      expect(color).toContain('orange');
      expect(color).toContain('bg-orange-100');
      expect(color).toContain('text-orange-800');
      expect(color).toContain('border-orange-300');
    });

    it('should return blue colors for z.ai', () => {
      const color = getProviderBadgeColor('zai');
      expect(color).toContain('blue');
      expect(color).toContain('bg-blue-100');
      expect(color).toContain('text-blue-800');
      expect(color).toContain('border-blue-300');
    });

    it('should return green colors for ZHIPU', () => {
      const color = getProviderBadgeColor('zhipu');
      expect(color).toContain('green');
      expect(color).toContain('bg-green-100');
      expect(color).toContain('text-green-800');
      expect(color).toContain('border-green-300');
    });

    it('should return gray colors for unknown', () => {
      const color = getProviderBadgeColor('unknown');
      expect(color).toContain('gray');
      expect(color).toContain('bg-gray-100');
      expect(color).toContain('text-gray-800');
      expect(color).toContain('border-gray-300');
    });
  });
});

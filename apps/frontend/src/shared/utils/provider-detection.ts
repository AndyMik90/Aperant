/**
 * Provider Detection Utilities
 *
 * Detects API provider type from baseUrl patterns.
 * Mirrors the logic from usage-monitor.ts for use in renderer process.
 *
 * NOTE: Keep this in sync with usage-monitor.ts provider detection logic
 */

/**
 * API Provider type for usage monitoring
 * Determines which usage endpoint to query and how to normalize responses
 */
export type ApiProvider = 'anthropic' | 'zai' | 'zhipu' | 'unknown';

/**
 * Provider detection patterns
 * Maps baseUrl patterns to provider types
 */
interface ProviderPattern {
  provider: ApiProvider;
  domainPatterns: string[];
}

const PROVIDER_PATTERNS: readonly ProviderPattern[] = [
  {
    provider: 'anthropic',
    domainPatterns: ['api.anthropic.com']
  },
  {
    provider: 'zai',
    domainPatterns: ['api.z.ai', 'z.ai']
  },
  {
    provider: 'zhipu',
    domainPatterns: ['open.bigmodel.cn', 'dev.bigmodel.cn', 'bigmodel.cn']
  }
] as const;

/**
 * Detect API provider from baseUrl
 * Extracts domain and matches against known provider patterns
 *
 * @param baseUrl - The API base URL (e.g., 'https://api.z.ai/api/anthropic')
 * @returns The detected provider type ('anthropic' | 'zai' | 'zhipu' | 'unknown')
 *
 * @example
 * detectProvider('https://api.anthropic.com') // returns 'anthropic'
 * detectProvider('https://api.z.ai/api/anthropic') // returns 'zai'
 * detectProvider('https://open.bigmodel.cn/api/anthropic') // returns 'zhipu'
 * detectProvider('https://unknown.com/api') // returns 'unknown'
 */
export function detectProvider(baseUrl: string): ApiProvider {
  try {
    // Extract domain from URL
    const url = new URL(baseUrl);
    const domain = url.hostname;

    // Match against provider patterns
    for (const pattern of PROVIDER_PATTERNS) {
      for (const patternDomain of pattern.domainPatterns) {
        if (domain === patternDomain || domain.endsWith(`.${patternDomain}`)) {
          return pattern.provider;
        }
      }
    }

    // No match found
    return 'unknown';
  } catch (_error) {
    // Invalid URL format
    return 'unknown';
  }
}

/**
 * Get human-readable provider label
 *
 * @param provider - The provider type
 * @returns Display label for the provider
 */
export function getProviderLabel(provider: ApiProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic';
    case 'zai':
      return 'z.ai';
    case 'zhipu':
      return 'ZHIPU AI';
    case 'unknown':
      return 'Unknown';
  }
}

/**
 * Get provider badge color scheme
 *
 * @param provider - The provider type
 * @returns CSS classes for badge styling
 */
export function getProviderBadgeColor(provider: ApiProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'bg-orange-500/10 text-orange-500 border-orange-500/20 hover:bg-orange-500/15';
    case 'zai':
      return 'bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/15';
    case 'zhipu':
      return 'bg-purple-500/10 text-purple-500 border-purple-500/20 hover:bg-purple-500/15';
    case 'unknown':
      return 'bg-gray-500/10 text-gray-500 border-gray-500/20 hover:bg-gray-500/15';
  }
}

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
 */
export function detectProvider(baseUrl: string): ApiProvider {
  try {
    const url = new URL(baseUrl);
    const domain = url.hostname;

    for (const pattern of PROVIDER_PATTERNS) {
      for (const patternDomain of pattern.domainPatterns) {
        if (domain === patternDomain || domain.endsWith(`.${patternDomain}`)) {
          return pattern.provider;
        }
      }
    }

    return 'unknown';
  } catch (_error) {
    return 'unknown';
  }
}

/**
 * Get human-readable provider label
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
 */
export function getProviderBadgeColor(provider: ApiProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'zai':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'zhipu':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'unknown':
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

/**
 * Get usage endpoint for a provider
 */
export function getUsageEndpoint(provider: ApiProvider, baseUrl: string): string | null {
  switch (provider) {
    case 'anthropic':
      return `${baseUrl}/api/oauth/usage`;
    case 'zai':
      return `${baseUrl}/api/monitor/usage/quota/limit`;
    case 'zhipu':
      return `${baseUrl}/api/monitor/usage/quota/limit`;
    case 'unknown':
      return null;
  }
}

import type { ProviderInfo } from '../types/provider-account';

export const OPENAI_EQUIVALENT_MODEL_LABELS: Record<string, string> = {
  default: 'GPT-5.3-Codex',
  haiku: 'GPT-5.4-Mini',
  sonnet: 'GPT-5.3-Codex',
  opus: 'GPT-5.4',
  'opus-1m': 'GPT-5.4',
  'opus-4.5': 'GPT-5.4',
};

export const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'anthropic',
    name: 'Claude Code',
    description: 'Claude subscriptions authenticated through Claude Code.',
    authMethods: ['oauth'],
  },
  {
    id: 'openai',
    name: 'OpenAI Codex',
    description: 'Native OpenAI Codex OAuth accounts.',
    authMethods: ['oauth'],
  },
  {
    id: 'openai-compatible',
    name: 'Custom Endpoints',
    description: 'Custom Anthropic-compatible API endpoints with API keys.',
    authMethods: ['api-key'],
  },
];

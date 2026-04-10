import type { ProviderAccount } from '../../shared/types';
import type { APIProfile } from '../../shared/types/profile';
import { OPENAI_EQUIVALENT_MODEL_LABELS } from '../../shared/constants/providers';

export interface TaskProviderOption {
  id: string;
  name: string;
  provider: ProviderAccount['provider'];
  type: 'oauth' | 'api';
  usagePercent?: number;
}

export const OPENAI_PROVIDER_MODEL_LABELS = OPENAI_EQUIVALENT_MODEL_LABELS;

export function getProviderAccountType(account: ProviderAccount): 'oauth' | 'api' {
  return account.authType === 'oauth' ? 'oauth' : 'api';
}

export function getProviderAccountLabel(account: ProviderAccount): string {
  switch (account.provider) {
    case 'anthropic':
      return 'Claude Code';
    case 'openai':
      return 'OpenAI Codex';
    case 'openai-compatible':
      return 'Custom Endpoint';
    case 'openrouter':
      return 'OpenRouter';
    case 'groq':
      return 'Groq';
    case 'zai':
      return 'Z.AI';
    case 'minimax':
      return 'MiniMax';
    default:
      return account.provider;
  }
}

export function toTaskProviderOption(
  account: ProviderAccount,
  usagePercent?: number
): TaskProviderOption {
  return {
    id: account.id,
    name: account.name,
    provider: account.provider,
    type: getProviderAccountType(account),
    ...(usagePercent !== undefined ? { usagePercent } : {}),
  };
}

export function getProviderModelLabels(
  account: ProviderAccount | undefined,
  apiProfiles: APIProfile[]
): Record<string, string> | undefined {
  if (!account) {
    return undefined;
  }

  if (account.provider === 'openai') {
    return OPENAI_PROVIDER_MODEL_LABELS;
  }

  if (account.provider !== 'openai-compatible' || !account.apiProfileId) {
    return undefined;
  }

  const profile = apiProfiles.find((candidate) => candidate.id === account.apiProfileId);
  if (!profile?.models) {
    return undefined;
  }

  const labels: Record<string, string> = {};
  if (profile.models.default) labels.default = profile.models.default;
  if (profile.models.haiku) labels.haiku = profile.models.haiku;
  if (profile.models.sonnet) labels.sonnet = profile.models.sonnet;
  if (profile.models.opus) {
    labels.opus = profile.models.opus;
    labels['opus-1m'] = profile.models.opus;
    labels['opus-4.5'] = profile.models.opus;
  }

  return Object.keys(labels).length > 0 ? labels : undefined;
}

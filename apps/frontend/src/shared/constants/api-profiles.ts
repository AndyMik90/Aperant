export type ApiProviderPreset = {
  id: string;
  baseUrl: string;
  labelKey: string;
};

export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  {
    id: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    labelKey: 'settings:apiProfiles.presets.anthropic'
  },
  {
    id: 'openrouter',
    baseUrl: 'https://openrouter.ai/api',
    labelKey: 'settings:apiProfiles.presets.openrouter'
  },
  {
    id: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    labelKey: 'settings:apiProfiles.presets.groq'
  },
  {
    id: 'zai-global',
    baseUrl: 'https://api.z.ai/api/anthropic',
    labelKey: 'settings:apiProfiles.presets.zaiGlobal'
  },
  {
    id: 'zai-cn',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    labelKey: 'settings:apiProfiles.presets.zaiChina'
  }
];

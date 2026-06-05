import type { ProviderInfo } from '../types/provider-account';

export const PROVIDER_REGISTRY: ProviderInfo[] = [
  {
    id: 'anthropic', name: 'Anthropic', description: 'Claude models',
    category: 'popular',
    authMethods: ['oauth', 'api-key'], envVars: ['ANTHROPIC_API_KEY'],
    configFields: [], website: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai', name: 'OpenAI', description: 'GPT and Codex models',
    category: 'popular',
    authMethods: ['oauth', 'api-key'], envVars: ['OPENAI_API_KEY'],
    configFields: [], website: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'google', name: 'Google AI', description: 'Gemini models',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['GOOGLE_GENERATIVE_AI_API_KEY'],
    configFields: [], website: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter', name: 'OpenRouter', description: 'Access 300+ models from all providers',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['OPENROUTER_API_KEY'],
    configFields: [], website: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'zai', name: 'Z.AI', description: 'GLM models',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['ZHIPU_API_KEY'],
    configFields: ['baseUrl'], website: 'https://z.ai/model-api',
  },
  {
    id: 'xai', name: 'xAI', description: 'Grok models',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['XAI_API_KEY'],
    configFields: [], website: 'https://console.x.ai',
  },
  {
    id: 'mistral', name: 'Mistral', description: 'Mistral and Codestral models',
    category: 'infrastructure',
    authMethods: ['api-key'], envVars: ['MISTRAL_API_KEY'],
    configFields: [], website: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq', name: 'Groq', description: 'Ultra-fast LLaMA inference',
    category: 'infrastructure',
    authMethods: ['api-key'], envVars: ['GROQ_API_KEY'],
    configFields: [], website: 'https://console.groq.com/keys',
  },
  {
    id: 'amazon-bedrock', name: 'AWS Bedrock', description: 'AWS-hosted models',
    category: 'infrastructure',
    authMethods: ['api-key'], envVars: ['AWS_ACCESS_KEY_ID'],
    configFields: ['region'],
  },
  {
    id: 'azure', name: 'Azure OpenAI', description: 'Azure-hosted OpenAI models',
    category: 'infrastructure',
    authMethods: ['api-key'], envVars: ['AZURE_OPENAI_API_KEY'],
    configFields: ['baseUrl'],
  },
  {
    id: 'minimax', name: 'MiniMax', description: 'MiniMax M3, M2.7 and M2.7-highspeed models',
    category: 'popular',
    authMethods: ['api-key'], envVars: ['MINIMAX_API_KEY'],
    configFields: ['baseUrl'], website: 'https://platform.minimax.io',
  },
  {
    id: 'ollama', name: 'Ollama', description: 'Local open-source models',
    category: 'local',
    authMethods: [], envVars: [],
    configFields: ['baseUrl'],
  },
  {
    id: 'openai-compatible', name: 'Custom Endpoint', description: 'Any OpenAI-compatible API (OpenRouter, proxies, local servers)',
    category: 'local',
    authMethods: ['api-key'], envVars: [],
    configFields: ['baseUrl'],
  },
];

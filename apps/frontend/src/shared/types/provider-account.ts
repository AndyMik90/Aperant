export type BuiltinProvider =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'groq'
  | 'zai'
  | 'minimax';

export type BillingModel = 'subscription' | 'pay-per-use';

export interface ProviderAccount {
  id: string;
  provider: BuiltinProvider;
  name: string;
  authType: 'oauth' | 'api-key';
  billingModel: BillingModel;
  email?: string;
  baseUrl?: string;
  region?: string;
  createdAt: number;
  updatedAt: number;
  claudeProfileId?: string;
  apiProfileId?: string;
}

export interface ProviderInfo {
  id: BuiltinProvider;
  name: string;
  description: string;
  authMethods: Array<'oauth' | 'api-key'>;
}

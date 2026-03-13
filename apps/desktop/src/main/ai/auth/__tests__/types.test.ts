/**
 * Tests for AI Auth Types
 *
 * Validates that exported constants have the correct mappings
 * for environment variables, settings keys, and base URL env vars.
 */

import { describe, expect, it } from 'vitest';
import {
  PROVIDER_ENV_VARS,
  PROVIDER_SETTINGS_KEY,
  PROVIDER_BASE_URL_ENV,
} from '../types';

describe('PROVIDER_ENV_VARS', () => {
  it('maps anthropic to ANTHROPIC_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.anthropic).toBe('ANTHROPIC_API_KEY');
  });

  it('maps openai to OPENAI_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.openai).toBe('OPENAI_API_KEY');
  });

  it('maps google to GOOGLE_GENERATIVE_AI_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.google).toBe('GOOGLE_GENERATIVE_AI_API_KEY');
  });

  it('maps bedrock to undefined (uses AWS credential chain)', () => {
    expect(PROVIDER_ENV_VARS.bedrock).toBeUndefined();
  });

  it('maps azure to AZURE_OPENAI_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.azure).toBe('AZURE_OPENAI_API_KEY');
  });

  it('maps mistral to MISTRAL_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.mistral).toBe('MISTRAL_API_KEY');
  });

  it('maps groq to GROQ_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.groq).toBe('GROQ_API_KEY');
  });

  it('maps xai to XAI_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.xai).toBe('XAI_API_KEY');
  });

  it('maps openrouter to OPENROUTER_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.openrouter).toBe('OPENROUTER_API_KEY');
  });

  it('maps zai to ZHIPU_API_KEY', () => {
    expect(PROVIDER_ENV_VARS.zai).toBe('ZHIPU_API_KEY');
  });

  it('maps ollama to undefined (no auth required)', () => {
    expect(PROVIDER_ENV_VARS.ollama).toBeUndefined();
  });
});

describe('PROVIDER_SETTINGS_KEY', () => {
  it('maps anthropic to globalAnthropicApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.anthropic).toBe('globalAnthropicApiKey');
  });

  it('maps openai to globalOpenAIApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.openai).toBe('globalOpenAIApiKey');
  });

  it('maps google to globalGoogleApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.google).toBe('globalGoogleApiKey');
  });

  it('maps groq to globalGroqApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.groq).toBe('globalGroqApiKey');
  });

  it('maps mistral to globalMistralApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.mistral).toBe('globalMistralApiKey');
  });

  it('maps xai to globalXAIApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.xai).toBe('globalXAIApiKey');
  });

  it('maps azure to globalAzureApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.azure).toBe('globalAzureApiKey');
  });

  it('maps openrouter to globalOpenRouterApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.openrouter).toBe('globalOpenRouterApiKey');
  });

  it('maps zai to globalZAIApiKey', () => {
    expect(PROVIDER_SETTINGS_KEY.zai).toBe('globalZAIApiKey');
  });

  it('does not have a key for bedrock', () => {
    expect(PROVIDER_SETTINGS_KEY.bedrock).toBeUndefined();
  });

  it('does not have a key for ollama', () => {
    expect(PROVIDER_SETTINGS_KEY.ollama).toBeUndefined();
  });
});

describe('PROVIDER_BASE_URL_ENV', () => {
  it('maps anthropic to ANTHROPIC_BASE_URL', () => {
    expect(PROVIDER_BASE_URL_ENV.anthropic).toBe('ANTHROPIC_BASE_URL');
  });

  it('maps openai to OPENAI_BASE_URL', () => {
    expect(PROVIDER_BASE_URL_ENV.openai).toBe('OPENAI_BASE_URL');
  });

  it('maps azure to AZURE_OPENAI_ENDPOINT', () => {
    expect(PROVIDER_BASE_URL_ENV.azure).toBe('AZURE_OPENAI_ENDPOINT');
  });

  it('does not define base URL env for other providers', () => {
    expect(PROVIDER_BASE_URL_ENV.google).toBeUndefined();
    expect(PROVIDER_BASE_URL_ENV.groq).toBeUndefined();
    expect(PROVIDER_BASE_URL_ENV.mistral).toBeUndefined();
  });
});

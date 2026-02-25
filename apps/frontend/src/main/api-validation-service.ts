/**
 * API Validation Service
 *
 * Provides validation for external LLM API providers (OpenAI, Anthropic, Google, etc.)
 * Used by the Graphiti memory integration for embedding and LLM operations.
 */

import https from 'https';
import type { IncomingMessage } from 'http';

export interface ApiValidationResult {
  success: boolean;
  message: string;
  details?: {
    provider?: string;
    model?: string;
    latencyMs?: number;
  };
}

/**
 * Validate OpenAI API key by attempting to list models
 * @param apiKey - OpenAI API key
 */
export async function validateOpenAIApiKey(
  apiKey: string
): Promise<ApiValidationResult> {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      message: 'API key is required',
    };
  }

  // Basic format validation
  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith('sk-') && !trimmedKey.startsWith('sess-')) {
    return {
      success: false,
      message: 'Invalid API key format. OpenAI API keys should start with "sk-" or "sess-"',
    };
  }

  try {
    const startTime = Date.now();

    // Use native https module to avoid additional dependencies
    const result = await new Promise<ApiValidationResult>((resolve) => {
      const options = {
        hostname: 'api.openai.com',
        port: 443,
        path: '/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${trimmedKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      };

      const req = https.request(options, (res: IncomingMessage) => {
        let data = '';

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
        });

        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          const statusCode = res.statusCode ?? 0;

          if (statusCode === 200) {
            resolve({
              success: true,
              message: 'OpenAI API key is valid',
              details: {
                provider: 'openai',
                latencyMs,
              },
            });
          } else if (statusCode === 401) {
            resolve({
              success: false,
              message: 'Invalid API key. Please check your OpenAI API key.',
            });
          } else if (statusCode === 429) {
            // Rate limited but key is valid
            resolve({
              success: true,
              message: 'OpenAI API key is valid (rate limited, please wait)',
              details: {
                provider: 'openai',
                latencyMs,
              },
            });
          } else {
            try {
              const errorData = JSON.parse(data);
              resolve({
                success: false,
                message: errorData.error?.message || `API error: ${statusCode}`,
              });
            } catch {
              resolve({
                success: false,
                message: `API error: ${statusCode}`,
              });
            }
          }
        });
      });

      req.on('error', (error: Error) => {
        resolve({
          success: false,
          message: `Connection error: ${error.message}`,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          message: 'Connection timeout. Please check your network connection.',
        });
      });

      req.end();
    });

    return result;
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Validate Anthropic API key
 * @param apiKey - Anthropic API key
 */
export async function validateAnthropicApiKey(
  apiKey: string
): Promise<ApiValidationResult> {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      message: 'API key is required',
    };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith('sk-ant-')) {
    return {
      success: false,
      message: 'Invalid API key format. Anthropic API keys should start with "sk-ant-"',
    };
  }

  // For now, just validate format - full validation would require an API call
  return {
    success: true,
    message: 'Anthropic API key format is valid',
    details: {
      provider: 'anthropic',
    },
  };
}

/**
 * Validate Google AI API key
 * @param apiKey - Google AI API key
 */
export async function validateGoogleApiKey(
  apiKey: string
): Promise<ApiValidationResult> {
  if (!apiKey || !apiKey.trim()) {
    return {
      success: false,
      message: 'API key is required',
    };
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey.startsWith('AIza')) {
    return {
      success: false,
      message: 'Invalid API key format. Google AI API keys should start with "AIza"',
    };
  }

  return {
    success: true,
    message: 'Google AI API key format is valid',
    details: {
      provider: 'google',
    },
  };
}

/**
 * Validate an LLM provider API key based on provider type
 * @param provider - The LLM provider (openai, anthropic, google, etc.)
 * @param apiKey - The API key to validate
 */
export async function validateLLMApiKey(
  provider: string,
  apiKey: string
): Promise<ApiValidationResult> {
  switch (provider) {
    case 'openai':
      return validateOpenAIApiKey(apiKey);
    case 'anthropic':
      return validateAnthropicApiKey(apiKey);
    case 'google':
      return validateGoogleApiKey(apiKey);
    case 'ollama':
      // Ollama is local, no API key needed
      return {
        success: true,
        message: 'Ollama runs locally, no API key required',
        details: { provider: 'ollama' },
      };
    case 'azure_openai':
      // Azure OpenAI uses different auth, just validate presence
      if (!apiKey || !apiKey.trim()) {
        return {
          success: false,
          message: 'Azure OpenAI API key is required',
        };
      }
      return {
        success: true,
        message: 'Azure OpenAI API key format accepted',
        details: { provider: 'azure_openai' },
      };
    default:
      return {
        success: false,
        message: `Unknown provider: ${provider}`,
      };
  }
}

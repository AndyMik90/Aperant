import type { ClaudeUsageSnapshot } from '../../shared/types/agent';

const CODEX_USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

export interface CodexRateWindow {
  used_percent: number;
  limit_window_seconds: number;
  reset_at: number;
  reset_after_seconds: number;
}

export interface CodexUsageResponse {
  user_id?: string;
  account_id?: string;
  email?: string;
  plan_type?: string;
  rate_limit?: {
    allowed?: boolean;
    limit_reached?: boolean;
    primary_window?: CodexRateWindow;
    secondary_window?: CodexRateWindow | null;
  };
  credits?: unknown;
}

export async function fetchCodexUsage(
  accessToken: string,
  accountId?: string,
): Promise<CodexUsageResponse | null> {
  const safeToken = typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : '';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${safeToken}`,
    'Content-Type': 'application/json',
  };

  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(CODEX_USAGE_ENDPOINT, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const error = new Error(`Codex API Auth Failure: ${response.status}`);
        (error as NodeJS.ErrnoException & { statusCode?: number }).statusCode = response.status;
        throw error;
      }

      console.error('[CodexUsageFetcher] API error:', response.status, response.statusText);
      return null;
    }

    return (await response.json()) as CodexUsageResponse;
  } catch (error) {
    const statusCode = (error as NodeJS.ErrnoException & { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) {
      throw error;
    }

    console.error('[CodexUsageFetcher] Fetch failed:', error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeCodexResponse(
  data: CodexUsageResponse,
  profileId: string,
  profileName: string,
  profileEmail?: string,
): ClaudeUsageSnapshot {
  const primary = data.rate_limit?.primary_window;
  const secondary = data.rate_limit?.secondary_window;

  const sessionPercent = primary
    ? Math.min(100, Math.max(0, Math.round(primary.used_percent)))
    : 0;
  const weeklyPercent = secondary
    ? Math.min(100, Math.max(0, Math.round(secondary.used_percent)))
    : 0;

  const toIso = (timestamp?: number): string | undefined => {
    if (!timestamp) {
      return undefined;
    }
    return new Date(timestamp * 1000).toISOString();
  };

  const resolvedEmail = profileEmail ?? data.email;

  return {
    profileId,
    profileName,
    profileEmail: resolvedEmail,
    sessionPercent,
    weeklyPercent,
    sessionResetTimestamp: toIso(primary?.reset_at),
    weeklyResetTimestamp: toIso(secondary?.reset_at),
    fetchedAt: new Date(),
    limitType: sessionPercent >= weeklyPercent ? 'session' : 'weekly',
    needsReauthentication: false,
    usageWindows: {
      sessionWindowLabel: 'common:usage.window5Hour',
      weeklyWindowLabel: 'common:usage.window7Day',
    },
  };
}

export function getCodexAccountId(accessToken: string): string | undefined {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) {
      return undefined;
    }

    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    ) as Record<string, unknown>;

    const id = payload.chatgpt_account_id ?? payload.account_id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

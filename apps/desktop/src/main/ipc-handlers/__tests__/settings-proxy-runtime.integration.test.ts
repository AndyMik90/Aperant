import path from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPC_CHANNELS } from '@shared/constants';

const {
  mockedUndiciFetch,
  settingsState,
  MockProxyAgent,
  closeMock,
} = vi.hoisted(() => {
  const closeSpy = vi.fn(async () => undefined);

  class ProxyAgentMock {
    readonly proxyUrl: string;

    constructor(proxyUrl: string) {
      this.proxyUrl = proxyUrl;
    }

    close = closeSpy;
  }

  return {
    mockedUndiciFetch: vi.fn(),
    settingsState: {
      data: {} as Record<string, unknown>,
      path: '/tmp/settings-proxy-initial.json',
    },
    MockProxyAgent: ProxyAgentMock,
    closeMock: closeSpy,
  };
});

vi.mock('undici', () => ({
  fetch: mockedUndiciFetch,
  ProxyAgent: MockProxyAgent,
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  app: {
    getPath: vi.fn(() => tmpdir()),
    getAppPath: vi.fn(() => '/test/app'),
    getVersion: vi.fn(() => '0.0.0-test'),
  },
  shell: {
    openExternal: vi.fn(),
  },
  session: {
    defaultSession: {
      setSpellCheckerLanguages: vi.fn(),
    },
  },
}));

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true },
}));

vi.mock('../../settings-utils', () => ({
  getSettingsPath: vi.fn(() => settingsState.path),
  readSettingsFile: vi.fn(() => settingsState.data),
}));

vi.mock('../../app-language', () => ({
  setAppLanguage: vi.fn(),
}));

vi.mock('../../app-updater', () => ({
  setUpdateChannel: vi.fn(),
  setUpdateChannelWithDowngradeCheck: vi.fn(),
}));

vi.mock('../context/memory-service-factory', () => ({
  resetMemoryService: vi.fn(),
}));

vi.mock('../../cli-tool-manager', () => ({
  configureTools: vi.fn(),
  getToolPath: vi.fn(),
  getToolInfo: vi.fn(),
  isPathFromWrongPlatform: vi.fn(() => false),
  preWarmToolCache: vi.fn(async () => undefined),
}));

vi.mock('../../utils/profile-manager', () => ({
  loadProfilesFile: vi.fn(async () => ({ profiles: [] })),
}));

vi.mock('../../claude-profile/profile-storage', () => ({
  loadProfileStore: vi.fn(() => null),
}));

import { ipcMain } from 'electron';
import { registerSettingsHandlers } from '../settings-handlers';
import type { AgentManager } from '../../agent';
import { getProxyAgentFromEnvironment, getProxyUrlFromEnvironment } from '../../utils/runtime-proxy-config';
import { fetchCodexUsage } from '../../claude-profile/codex-usage-fetcher';

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'] as const;
let baselineProxyEnv: Partial<Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>> = {};

function clearProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

function snapshotProxyEnv(): Partial<Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>> {
  return Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]])) as Partial<
    Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>
  >;
}

function restoreProxyEnv(snapshot: Partial<Record<(typeof PROXY_ENV_KEYS)[number], string | undefined>>): void {
  for (const key of PROXY_ENV_KEYS) {
    const value = snapshot[key];
    if (typeof value === 'undefined') {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

function getSettingsSaveHandler(): (...args: unknown[]) => Promise<{ success: boolean; error?: string }> {
  const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
  const settingsSaveCall = handleCalls.find((call) => call[0] === IPC_CHANNELS.SETTINGS_SAVE);

  if (!settingsSaveCall?.[1]) {
    throw new Error('settings:save handler was not registered');
  }

  return settingsSaveCall[1] as (...args: unknown[]) => Promise<{ success: boolean; error?: string }>;
}

async function captureDispatcherForCodexUsage(): Promise<unknown> {
  mockedUndiciFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
  });

  await fetchCodexUsage('test-token');
  const call = mockedUndiciFetch.mock.calls.at(-1);
  return call?.[1]?.dispatcher;
}

describe('settings:save proxy runtime integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baselineProxyEnv = snapshotProxyEnv();
    clearProxyEnv();

    settingsState.data = {};
    settingsState.path = path.join(tmpdir(), `settings-proxy-${Date.now()}.json`);

    registerSettingsHandlers(
      {
        configure: vi.fn(),
      } as unknown as AgentManager,
      () => null,
    );
  });

  afterEach(() => {
    restoreProxyEnv(baselineProxyEnv);
  });

  it('applies valid proxy from settings save and propagates to network paths', async () => {
    const handler = getSettingsSaveHandler();
    const result = await handler(
      {},
      {
        proxyEnabled: true,
        proxyHttpUrl: 'http://127.0.0.1:8080',
      },
    );

    expect(result).toEqual({ success: true });
    expect(process.env.HTTP_PROXY).toBe('http://127.0.0.1:8080/');
    expect(process.env.HTTPS_PROXY).toBe('http://127.0.0.1:8080/');
    expect(getProxyUrlFromEnvironment()).toBe('http://127.0.0.1:8080/');
    expect(getProxyUrlFromEnvironment('http://example.local')).toBe('http://127.0.0.1:8080/');
    expect(getProxyUrlFromEnvironment('https://example.local')).toBe('http://127.0.0.1:8080/');

    const dispatcher = await captureDispatcherForCodexUsage();
    expect(dispatcher).toBeInstanceOf(MockProxyAgent);
    expect((dispatcher as { proxyUrl: string }).proxyUrl).toBe('http://127.0.0.1:8080/');
  });

  it('selects scheme-specific proxy and reuses/disposes cached proxy agents', () => {
    process.env.HTTP_PROXY = 'http://http-proxy.local:8080/';
    process.env.HTTPS_PROXY = 'http://https-proxy.local:9090/';

    const httpProxyUrl = getProxyUrlFromEnvironment('http://service.local/endpoint');
    const httpsProxyUrl = getProxyUrlFromEnvironment('https://service.local/endpoint');

    expect(httpProxyUrl).toBe('http://http-proxy.local:8080/');
    expect(httpsProxyUrl).toBe('http://https-proxy.local:9090/');

    const httpAgent = getProxyAgentFromEnvironment('http://service.local/endpoint');
    const httpAgentAgain = getProxyAgentFromEnvironment('http://service.local/endpoint');
    const httpsAgent = getProxyAgentFromEnvironment('https://service.local/endpoint');

    expect(httpAgent).toBe(httpAgentAgain);
    expect(httpAgent).not.toBe(httpsAgent);

    process.env.HTTP_PROXY = 'http://new-http-proxy.local:7070/';
    const refreshedHttpAgent = getProxyAgentFromEnvironment('http://service.local/endpoint');

    expect(refreshedHttpAgent).not.toBe(httpAgent);
    expect(closeMock).toHaveBeenCalled();
  });

  it('rejects invalid proxy settings and keeps existing environment unchanged', async () => {
    process.env.HTTP_PROXY = 'http://existing-proxy.local:9000/';
    process.env.HTTPS_PROXY = 'http://existing-proxy.local:9000/';

    const handler = getSettingsSaveHandler();
    const result = await handler(
      {},
      {
        proxyEnabled: true,
        proxyHttpUrl: 'socks5://127.0.0.1:1080',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid proxy settings.');
    expect(process.env.HTTP_PROXY).toBe('http://existing-proxy.local:9000/');
    expect(process.env.HTTPS_PROXY).toBe('http://existing-proxy.local:9000/');
  });

  it('disables proxy via settings save and clears runtime env behavior', async () => {
    const handler = getSettingsSaveHandler();

    const enableResult = await handler(
      {},
      {
        proxyEnabled: true,
        proxyHttpsUrl: 'http://127.0.0.1:9090',
      },
    );
    expect(enableResult).toEqual({ success: true });
    expect(getProxyUrlFromEnvironment()).toBe('http://127.0.0.1:9090/');

    const disableResult = await handler({}, { proxyEnabled: false });
    expect(disableResult).toEqual({ success: true });
    expect(process.env.HTTP_PROXY).toBeUndefined();
    expect(process.env.http_proxy).toBeUndefined();
    expect(process.env.HTTPS_PROXY).toBeUndefined();
    expect(process.env.https_proxy).toBeUndefined();
    expect(getProxyUrlFromEnvironment()).toBeUndefined();

    const dispatcher = await captureDispatcherForCodexUsage();
    expect(dispatcher).toBeUndefined();
  });
});

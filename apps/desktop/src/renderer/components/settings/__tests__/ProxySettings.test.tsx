/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../../shared/i18n';
import { ProxySettings } from '../ProxySettings';
import type { AppSettings } from '../../../../shared/types';

const defaultSettings: AppSettings = {
  theme: 'dark',
  colorTheme: 'default',
  defaultModel: 'opus',
  agentFramework: 'auto-claude',
  proxyEnabled: false,
  uiScale: 100,
  logOrder: 'chronological',
  gpuAcceleration: 'off',
  notifications: {
    onTaskComplete: true,
    onTaskFailed: true,
    onReviewNeeded: true,
    sound: false,
  },
} as AppSettings;

describe('ProxySettings', () => {
  let onSettingsChange: (settings: AppSettings) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    onSettingsChange = vi.fn();
  });

  it('keeps proxy toggle defaulted to false', () => {
    const settingsWithoutProxyEnabled = {
      ...defaultSettings,
      proxyEnabled: undefined,
    } as AppSettings;

    render(
      <ProxySettings settings={settingsWithoutProxyEnabled} onSettingsChange={onSettingsChange} />,
    );

    const proxyToggle = screen.getByRole('switch', { name: 'Enable Proxy' });
    expect(proxyToggle).toHaveAttribute('aria-checked', 'false');
  });

  it('auto-prefills default proxy URLs when enabling proxy with empty values', () => {
    render(
      <ProxySettings
        settings={{
          ...defaultSettings,
          proxyEnabled: false,
          proxyHttpUrl: '',
          proxyHttpsUrl: '',
        }}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Proxy' }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        proxyEnabled: true,
        proxyHttpUrl: 'http://127.0.0.1:7890',
        proxyHttpsUrl: 'http://127.0.0.1:7890',
      }),
    );
  });
});

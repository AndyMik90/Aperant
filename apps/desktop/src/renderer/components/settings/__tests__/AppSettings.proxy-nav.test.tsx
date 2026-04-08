/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import '../../../../shared/i18n';
import { AppSettingsDialog } from '../AppSettings';

const mockSaveSettings = vi.fn<() => Promise<boolean>>();
const mockCommitTheme = vi.fn();
const mockRevertTheme = vi.fn();

const mockUseSettingsState = {
  settings: {
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
  },
  setSettings: vi.fn(),
  isSaving: false,
  error: null as string | null,
  saveSettings: mockSaveSettings,
  revertTheme: mockRevertTheme,
  commitTheme: mockCommitTheme,
};

vi.mock('../hooks/useSettings', () => ({
  useSettings: () => mockUseSettingsState,
}));

vi.mock('../../../stores/project-store', () => {
  const state = {
    projects: [],
    selectedProjectId: null,
    selectProject: vi.fn(),
  };

  return {
    useProjectStore: vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
  };
});

vi.mock('../ProjectSettingsContent', () => ({
  ProjectSettingsContent: () => <div data-testid="project-settings-content" />,
}));

vi.mock('../ProjectSelector', () => ({
  ProjectSelector: () => <div data-testid="project-selector" />,
}));

vi.mock('../ThemeSettings', () => ({ ThemeSettings: () => <div data-testid="theme-settings" /> }));
vi.mock('../DisplaySettings', () => ({ DisplaySettings: () => <div data-testid="display-settings" /> }));
vi.mock('../LanguageSettings', () => ({ LanguageSettings: () => <div data-testid="language-settings" /> }));
vi.mock('../GeneralSettings', () => ({ GeneralSettings: () => <div data-testid="general-settings" /> }));
vi.mock('../AdvancedSettings', () => ({ AdvancedSettings: () => <div data-testid="advanced-settings" /> }));
vi.mock('../DevToolsSettings', () => ({ DevToolsSettings: () => <div data-testid="devtools-settings" /> }));
vi.mock('../DebugSettings', () => ({ DebugSettings: () => <div data-testid="debug-settings" /> }));
vi.mock('../ProxySettings', () => ({ ProxySettings: () => <div data-testid="proxy-settings" /> }));
vi.mock('../terminal-font-settings/TerminalFontSettings', () => ({
  TerminalFontSettings: () => <div data-testid="terminal-font-settings" />,
}));
vi.mock('../AccountSettings', () => ({ AccountSettings: () => <div data-testid="account-settings" /> }));

describe('AppSettingsDialog proxy navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSettingsState.error = null;
    mockUseSettingsState.isSaving = false;
    mockSaveSettings.mockResolvedValue(true);
    (window as unknown as { electronAPI: { getAppVersion: () => Promise<string> } }).electronAPI = {
      getAppVersion: vi.fn().mockResolvedValue('2.8.0-test'),
    };
  });

  it('shows the Proxy navigation item with its Network icon', () => {
    render(<AppSettingsDialog open onOpenChange={vi.fn()} initialSection="appearance" />);

    const proxyNavButton = screen.getByRole('button', { name: /proxy global network proxy settings/i });
    expect(proxyNavButton).toBeInTheDocument();

    const networkIcon = proxyNavButton.querySelector('svg.lucide-network');
    expect(networkIcon).toBeInTheDocument();
  });

  it('keeps dialog open and shows error when app save fails', async () => {
    const onOpenChange = vi.fn();
    mockUseSettingsState.error = 'Proxy URL for HTTP is invalid.';
    mockSaveSettings.mockResolvedValue(false);

    render(<AppSettingsDialog open onOpenChange={onOpenChange} initialSection="proxy" />);

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(mockCommitTheme).not.toHaveBeenCalled();
    expect(screen.getByText('Proxy URL for HTTP is invalid.')).toBeInTheDocument();
  });
});

import type { UseProjectSettingsReturn } from '../../project-settings/hooks/useProjectSettings';
import type { MutableRefObject } from 'react';

/**
 * Creates a proxy that always accesses the latest hook values via ref.
 * This prevents infinite loops caused by hook object recreation on each render.
 *
 * @param hookRef - Stable reference to the hook return value
 * @returns Proxy that provides access to the latest hook state
 */
export function createHookProxy(
  hookRef: MutableRefObject<UseProjectSettingsReturn>
): UseProjectSettingsReturn {
  return {
    get settings() { return hookRef.current.settings; },
    get setSettings() { return hookRef.current.setSettings; },
    get isSaving() { return hookRef.current.isSaving; },
    get error() { return hookRef.current.error; },
    get setError() { return hookRef.current.setError; },
    get versionInfo() { return hookRef.current.versionInfo; },
    get isCheckingVersion() { return hookRef.current.isCheckingVersion; },
    get isUpdating() { return hookRef.current.isUpdating; },
    get envConfig() { return hookRef.current.envConfig; },
    get setEnvConfig() { return hookRef.current.setEnvConfig; },
    get isLoadingEnv() { return hookRef.current.isLoadingEnv; },
    get envError() { return hookRef.current.envError; },
    get setEnvError() { return hookRef.current.setEnvError; },
    get updateEnvConfig() { return hookRef.current.updateEnvConfig; },
    get showClaudeToken() { return hookRef.current.showClaudeToken; },
    get setShowClaudeToken() { return hookRef.current.setShowClaudeToken; },
    get showLinearKey() { return hookRef.current.showLinearKey; },
    get setShowLinearKey() { return hookRef.current.setShowLinearKey; },
    get showOpenAIKey() { return hookRef.current.showOpenAIKey; },
    get setShowOpenAIKey() { return hookRef.current.setShowOpenAIKey; },
    get showGitHubToken() { return hookRef.current.showGitHubToken; },
    get setShowGitHubToken() { return hookRef.current.setShowGitHubToken; },
    get expandedSections() { return hookRef.current.expandedSections; },
    get toggleSection() { return hookRef.current.toggleSection; },
    get gitHubConnectionStatus() { return hookRef.current.gitHubConnectionStatus; },
    get isCheckingGitHub() { return hookRef.current.isCheckingGitHub; },
    get showGitLabToken() { return hookRef.current.showGitLabToken; },
    get setShowGitLabToken() { return hookRef.current.setShowGitLabToken; },
    get gitLabConnectionStatus() { return hookRef.current.gitLabConnectionStatus; },
    get isCheckingGitLab() { return hookRef.current.isCheckingGitLab; },
    get isCheckingClaudeAuth() { return hookRef.current.isCheckingClaudeAuth; },
    get claudeAuthStatus() { return hookRef.current.claudeAuthStatus; },
    get setClaudeAuthStatus() { return hookRef.current.setClaudeAuthStatus; },
    get showLinearImportModal() { return hookRef.current.showLinearImportModal; },
    get setShowLinearImportModal() { return hookRef.current.setShowLinearImportModal; },
    get linearConnectionStatus() { return hookRef.current.linearConnectionStatus; },
    get isCheckingLinear() { return hookRef.current.isCheckingLinear; },
    get handleInitialize() { return hookRef.current.handleInitialize; },
    get handleClaudeSetup() { return hookRef.current.handleClaudeSetup; },
    get handleSave() { return hookRef.current.handleSave; },
  };
}

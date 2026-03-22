import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../ui/tabs';
import { SecuritySettings } from '../../project-settings/SecuritySettings';
import { VaultIntegration } from './VaultIntegration';
import type { ProjectEnvConfig, ProjectSettings, AppSettings } from '../../../../shared/types';

interface MemoryContextSectionProps {
  envConfig: ProjectEnvConfig | null;
  updateEnvConfig: (updates: Partial<ProjectEnvConfig>) => void;
  settings: ProjectSettings;
  setSettings: React.Dispatch<React.SetStateAction<ProjectSettings>>;
  showOpenAIKey: boolean;
  setShowOpenAIKey: React.Dispatch<React.SetStateAction<boolean>>;
  appSettings: AppSettings;
  onAppSettingsChange: (settings: AppSettings) => void;
}

/**
 * Memory and context integration section.
 * Groups Memory backend (Graphiti) and Vault (external knowledge) configuration in a tabbed layout.
 */
export function MemoryContextSection(props: MemoryContextSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <Tabs defaultValue="memory" className="w-full">
      <TabsList className="w-full">
        <TabsTrigger value="memory" className="flex-1">{t('projectSections.memory.title')}</TabsTrigger>
        <TabsTrigger value="vault" className="flex-1">{t('vault.title')}</TabsTrigger>
      </TabsList>
      <TabsContent value="memory" className="mt-4">
        <SecuritySettings
          envConfig={props.envConfig}
          settings={props.settings}
          setSettings={props.setSettings}
          updateEnvConfig={props.updateEnvConfig}
          showOpenAIKey={props.showOpenAIKey}
          setShowOpenAIKey={props.setShowOpenAIKey}
          expanded={true}
          onToggle={() => {}}
        />
      </TabsContent>
      <TabsContent value="vault" className="mt-4">
        <VaultIntegration
          settings={props.appSettings}
          onSettingsChange={props.onAppSettingsChange}
        />
      </TabsContent>
    </Tabs>
  );
}

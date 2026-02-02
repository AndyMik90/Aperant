import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderTree, Brain } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useContextStore } from '../../stores/context-store';
import { useProjectContext, useRefreshIndex, useMemorySearch } from './hooks';
import { ProjectIndexTab } from './ProjectIndexTab';
import { MemoriesTab } from './MemoriesTab';
import type { ContextProps } from './types';

export function Context({ projectId }: ContextProps) {
  const { t } = useTranslation('context');
  const {
    projectIndex,
    indexLoading,
    indexError,
    memoryStatus,
    memoryState,
    recentMemories,
    memoriesLoading,
    searchResults,
    searchLoading
  } = useContextStore();

  const [activeTab, setActiveTab] = useState('index');

  // Custom hooks
  useProjectContext(projectId);
  const handleRefreshIndex = useRefreshIndex(projectId);
  const handleSearch = useMemorySearch(projectId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
        <div className="border-b border-border px-6 py-3">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="index" className="gap-2">
                <FolderTree className="h-4 w-4" />
                {t('tabs.projectIndex')}
              </TabsTrigger>
              <TabsTrigger value="memories" className="gap-2">
                <Brain className="h-4 w-4" />
                {t('tabs.memories')}
              </TabsTrigger>
            </TabsList>
        </div>

        {/* Project Index Tab */}
        <TabsContent value="index" className="flex-1 overflow-hidden m-0">
          <ProjectIndexTab
            projectIndex={projectIndex}
            indexLoading={indexLoading}
            indexError={indexError}
            onRefresh={handleRefreshIndex}
          />
        </TabsContent>

        {/* Memories Tab */}
        <TabsContent value="memories" className="flex-1 overflow-hidden m-0">
          <MemoriesTab
            memoryStatus={memoryStatus}
            memoryState={memoryState}
            recentMemories={recentMemories}
            memoriesLoading={memoriesLoading}
            searchResults={searchResults}
            searchLoading={searchLoading}
            onSearch={handleSearch}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

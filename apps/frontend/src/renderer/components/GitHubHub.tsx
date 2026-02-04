import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Github, GitPullRequest } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { GitHubIssues } from './GitHubIssues';
import { GitHubPRs } from './github-prs';

interface GitHubHubProps {
  onOpenSettings?: () => void;
  onNavigateToTask?: (taskId: string) => void;
  isActive?: boolean;
}

export function GitHubHub({ onOpenSettings, onNavigateToTask, isActive = false }: GitHubHubProps) {
  const { t } = useTranslation(['navigation']);
  const [activeTab, setActiveTab] = useState<'issues' | 'prs'>('issues');

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'issues' | 'prs')}
        className="flex h-full flex-col"
      >
        {/* Tab navigation header */}
        <div className="border-b border-border px-6 pt-4">
          <TabsList className="h-10">
            <TabsTrigger value="issues" className="gap-2">
              <Github className="h-4 w-4" />
              {t('items.githubIssues')}
            </TabsTrigger>
            <TabsTrigger value="prs" className="gap-2">
              <GitPullRequest className="h-4 w-4" />
              {t('items.githubPRs')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab content - fills remaining space */}
        <TabsContent value="issues" className="flex-1 m-0 overflow-hidden">
          <GitHubIssues onOpenSettings={onOpenSettings} onNavigateToTask={onNavigateToTask} />
        </TabsContent>

        {/* GitHubPRs needs isActive to manage review state properly */}
        <TabsContent value="prs" className="flex-1 m-0 overflow-hidden">
          <GitHubPRs onOpenSettings={onOpenSettings} isActive={isActive && activeTab === 'prs'} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

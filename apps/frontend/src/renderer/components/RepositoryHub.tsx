/**
 * RepositoryHub - Combined Context and Worktrees view
 *
 * NAV-2: Merge Context + Worktrees → Repository page
 * Uses tabs to switch between Context (Project Index/Memories) and Worktrees views.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, GitBranch } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Context } from './context/Context';
import { Worktrees } from './Worktrees';

interface RepositoryHubProps {
  projectId: string;
}

export function RepositoryHub({ projectId }: RepositoryHubProps) {
  const { t } = useTranslation(['navigation']);
  const [activeTab, setActiveTab] = useState<'context' | 'worktrees'>('context');

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'context' | 'worktrees')}
        className="flex h-full flex-col"
      >
        {/* Tab navigation header */}
        <div className="border-b border-border px-6 pt-4">
          <TabsList className="h-10">
            <TabsTrigger value="context" className="gap-2">
              <BookOpen className="h-4 w-4" />
              {t('items.context')}
            </TabsTrigger>
            <TabsTrigger value="worktrees" className="gap-2">
              <GitBranch className="h-4 w-4" />
              {t('items.worktrees')}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab content - fills remaining space */}
        <TabsContent value="context" className="flex-1 m-0 overflow-hidden">
          <Context projectId={projectId} />
        </TabsContent>

        <TabsContent value="worktrees" className="flex-1 m-0 overflow-hidden">
          <Worktrees projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

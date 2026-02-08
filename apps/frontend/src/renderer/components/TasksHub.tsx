/**
 * TasksHub - Combined Tasks view with tabs
 *
 * NAV-4: Add tabs to Tasks page (Kanban/Analytics)
 * Uses tabs to switch between Kanban board and Analytics dashboard.
 *
 * Note: Dependencies tab was planned but SUG-6 (task dependencies) was skipped
 * as it requires data model changes. Can be added later when implemented.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, BarChart3, RefreshCw, Search, X } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Button } from './ui/button';
import { KanbanBoard } from './KanbanBoard';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { ActivityFeed } from './ActivityFeed';
import type { Task } from '../../shared/types';

interface TasksHubProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  onNewTaskClick: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  isLoading?: boolean; // UX-3: Show skeleton loaders
}

export function TasksHub({
  tasks,
  onTaskClick,
  onNewTaskClick,
  onRefresh,
  isRefreshing = false,
  isLoading = false,
}: TasksHubProps) {
  const { t } = useTranslation(['navigation', 'tasks']);
  const [activeTab, setActiveTab] = useState<'kanban' | 'analytics'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="flex h-full flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'kanban' | 'analytics')}
        className="flex h-full flex-col"
      >
        {/* Tab navigation header */}
        <div className="border-b border-border px-6 pt-4 flex items-center justify-between">
          <TabsList className="h-10">
            <TabsTrigger value="kanban" className="gap-2">
              <LayoutGrid className="h-4 w-4" />
              {t('items.kanban')}
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              {t('tasks:analytics.title', { defaultValue: 'Analytics' })}
            </TabsTrigger>
          </TabsList>

          {/* Search bar - only show on kanban tab */}
          {activeTab === 'kanban' && (
            <div className="relative flex-1 max-w-xs mx-4">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder={t('tasks:searchPlaceholder', { defaultValue: 'Search tasks...' })}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-8 rounded-md border border-input bg-background pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Refresh button in header */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            {t('tasks:refreshTasks')}
          </Button>
        </div>

        {/* Tab content - fills remaining space */}
        <TabsContent value="kanban" className="flex-1 m-0 overflow-hidden">
          <KanbanBoard
            tasks={tasks}
            onTaskClick={onTaskClick}
            onNewTaskClick={onNewTaskClick}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            hideRefreshButton
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        </TabsContent>

        <TabsContent value="analytics" className="flex-1 m-0 overflow-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <AnalyticsDashboard />
            <ActivityFeed />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

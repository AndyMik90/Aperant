import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  RefreshCw,
  AlertCircle,
  Settings,
  Loader2,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { useProjectStore } from '../stores/project-store';
import { useProjectEnvStore } from '../stores/project-env-store';
import { useTaskStore } from '../stores/task-store';
import {
  useJiraStore,
  loadJiraIssues,
  checkJiraConnection,
  type JiraIssue
} from '../stores/jira-store';
import { JiraInvestigationDialog } from './jira-issues/components/InvestigationDialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { ScrollArea } from './ui/scroll-area';

interface JiraIssuesProps {
  onOpenSettings: () => void;
  onNavigateToTask: (taskId: string) => void;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getStatusBadgeVariant(status: string): 'success' | 'secondary' | 'info' | 'warning' | 'muted' {
  const lower = status.toLowerCase();
  if (['done', 'closed', 'resolved', 'complete'].includes(lower)) return 'success';
  if (['in progress', 'in review'].includes(lower)) return 'info';
  if (['to do', 'open', 'backlog', 'new'].includes(lower)) return 'secondary';
  if (['blocked', 'on hold'].includes(lower)) return 'warning';
  return 'muted';
}

function getPriorityBadgeVariant(priority?: string): 'destructive' | 'warning' | 'secondary' | 'muted' {
  if (!priority) return 'muted';
  const lower = priority.toLowerCase();
  if (['highest', 'blocker', 'critical'].includes(lower)) return 'destructive';
  if (['high', 'major'].includes(lower)) return 'warning';
  return 'secondary';
}

export function JiraIssues({ onOpenSettings, onNavigateToTask }: JiraIssuesProps) {
  const { t } = useTranslation('jira');
  const projects = useProjectStore((state) => state.projects);
  const selectedProjectId = useProjectStore((state) => state.selectedProjectId);
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const envConfig = useProjectEnvStore((state) => state.envConfig);
  const tasks = useTaskStore((state) => state.tasks);

  const connected = useJiraStore((state) => state.connected);
  const isLoading = useJiraStore((state) => state.isLoading);
  const error = useJiraStore((state) => state.error);
  const selectedIssueKey = useJiraStore((state) => state.selectedIssueKey);
  const filterState = useJiraStore((state) => state.filterState);
  const searchQuery = useJiraStore((state) => state.searchQuery);
  const selectIssue = useJiraStore((state) => state.selectIssue);
  const setFilterState = useJiraStore((state) => state.setFilterState);
  const setSearchQuery = useJiraStore((state) => state.setSearchQuery);
  const getFilteredIssues = useJiraStore((state) => state.getFilteredIssues);
  const getSelectedIssue = useJiraStore((state) => state.getSelectedIssue);
  const getOpenIssuesCount = useJiraStore((state) => state.getOpenIssuesCount);

  const [showInvestigateDialog, setShowInvestigateDialog] = useState(false);
  const [issueForInvestigation, setIssueForInvestigation] = useState<JiraIssue | null>(null);
  const [assignedToMe, setAssignedToMe] = useState(false);

  const jiraProjectKey = envConfig?.jiraProjectKey || '';
  const jiraUserName = envConfig?.jiraEmail?.split('@')[0] || '';

  const allFilteredIssues = getFilteredIssues();
  const filteredIssues = assignedToMe
    ? allFilteredIssues.filter(i => i.assignee?.toLowerCase().includes(jiraUserName.toLowerCase()))
    : allFilteredIssues;
  const selectedIssue = getSelectedIssue();
  const openCount = getOpenIssuesCount();
  const jiraEnabled = envConfig?.jiraEnabled || false;

  // Build a map of JIRA issue keys to task IDs for quick lookup
  const issueToTaskMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      if (task.metadata?.jiraIssueKey) {
        map.set(task.metadata.jiraIssueKey, task.specId || task.id);
      }
    }
    return map;
  }, [tasks]);

  // Check connection and load issues on mount
  useEffect(() => {
    if (!selectedProject?.id || !jiraEnabled || !jiraProjectKey) return;

    const init = async () => {
      const isConnected = await checkJiraConnection(selectedProject.id);
      if (isConnected) {
        await loadJiraIssues(selectedProject.id, jiraProjectKey);
      }
    };
    init();
  }, [selectedProject?.id, jiraEnabled, jiraProjectKey]);

  const handleRefresh = useCallback(() => {
    if (!selectedProject?.id || !jiraProjectKey) return;
    loadJiraIssues(selectedProject.id, jiraProjectKey);
  }, [selectedProject?.id, jiraProjectKey]);

  const handleFilterChange = useCallback((newFilter: 'open' | 'closed' | 'all') => {
    setFilterState(newFilter);
    if (selectedProject?.id && jiraProjectKey) {
      loadJiraIssues(selectedProject.id, jiraProjectKey, newFilter);
    }
  }, [selectedProject?.id, jiraProjectKey, setFilterState]);

  const handleInvestigate = useCallback((issue: JiraIssue) => {
    setIssueForInvestigation(issue);
    setShowInvestigateDialog(true);
  }, []);

  // Not connected state
  if (!jiraEnabled || !connected) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-md">
          <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">{t('notConnected.title')}</h3>
          <p className="text-sm text-muted-foreground">{t('notConnected.description')}</p>
          <Button onClick={onOpenSettings}>
            <Settings className="h-4 w-4 mr-2" />
            {t('notConnected.openSettings')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{jiraProjectKey}</h2>
            <Badge variant="muted" className="text-xs">
              {openCount} {t('header.open')}
            </Badge>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1">
          {(['open', 'closed', 'all'] as const).map((filter) => (
            <Button
              key={filter}
              variant={filterState === filter ? 'default' : 'ghost'}
              size="sm"
              className="text-xs h-7 px-2"
              onClick={() => handleFilterChange(filter)}
            >
              {t(`filters.${filter}`)}
            </Button>
          ))}
          <Button
            variant={assignedToMe ? 'default' : 'ghost'}
            size="sm"
            className="text-xs h-7 px-2"
            onClick={() => setAssignedToMe(!assignedToMe)}
          >
            My Issues
          </Button>
        </div>

        {/* Search */}
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t('header.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 flex min-h-0">
        {/* Issue List */}
        <div className="w-1/2 border-r border-border flex flex-col">
          {isLoading && filteredIssues.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center p-4">
              <div className="text-center space-y-2">
                <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">{t('empty.noMatch')}</p>
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="divide-y divide-border">
                {filteredIssues.map((issue) => {
                  const linkedTaskId = issueToTaskMap.get(issue.key);
                  return (
                    <button
                      type="button"
                      key={issue.key}
                      className={`w-full text-left p-3 hover:bg-accent/50 transition-colors cursor-pointer ${
                        selectedIssueKey === issue.key ? 'bg-accent' : ''
                      }`}
                      onClick={() => selectIssue(issue.key)}
                    >
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
                            <Badge variant={getStatusBadgeVariant(issue.status)} className="text-[10px] px-1.5 py-0">
                              {issue.status}
                            </Badge>
                            {issue.priority && (
                              <Badge variant={getPriorityBadgeVariant(issue.priority)} className="text-[10px] px-1.5 py-0">
                                {issue.priority}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm truncate">{issue.summary}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{issue.issueType}</span>
                            <span className="text-muted-foreground/60">|</span>
                            <span className={issue.assignee ? 'text-foreground/70 font-medium' : 'italic text-muted-foreground/50'}>
                              {issue.assignee || 'Unassigned'}
                            </span>
                            {linkedTaskId && (
                              <Badge variant="info" className="text-[10px] px-1 py-0 ml-auto">
                                Linked
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Issue Detail */}
        <div className="w-1/2 flex flex-col">
          {selectedIssue ? (
            <IssueDetailPanel
              issue={selectedIssue}
              linkedTaskId={issueToTaskMap.get(selectedIssue.key)}
              onInvestigate={() => handleInvestigate(selectedIssue)}
              onViewTask={onNavigateToTask}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">{t('empty.selectIssue')}</p>
            </div>
          )}
        </div>
      </div>

      {/* Investigation Dialog */}
      {issueForInvestigation && selectedProject?.id && (
        <JiraInvestigationDialog
          open={showInvestigateDialog}
          onOpenChange={setShowInvestigateDialog}
          issueKey={issueForInvestigation.key}
          issueSummary={issueForInvestigation.summary}
          projectId={selectedProject.id}
        />
      )}
    </div>
  );
}

// ---- Issue Detail Panel (inline sub-component) ----

interface IssueDetailPanelProps {
  issue: JiraIssue;
  linkedTaskId?: string;
  onInvestigate: () => void;
  onViewTask: (taskId: string) => void;
}

function IssueDetailPanel({ issue, linkedTaskId, onInvestigate, onViewTask }: IssueDetailPanelProps) {
  const { t } = useTranslation('jira');

  return (
    <ScrollArea className="flex-1">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-muted-foreground">{issue.key}</span>
            <Badge variant={getStatusBadgeVariant(issue.status)}>
              {issue.status}
            </Badge>
            {issue.priority && (
              <Badge variant={getPriorityBadgeVariant(issue.priority)}>
                {issue.priority}
              </Badge>
            )}
          </div>
          <h3 className="text-base font-semibold">{issue.summary}</h3>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {linkedTaskId ? (
            <Button variant="outline" size="sm" onClick={() => onViewTask(linkedTaskId)}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {t('detail.viewTask')}
            </Button>
          ) : (
            <Button size="sm" onClick={onInvestigate}>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {t('detail.createTask')}
            </Button>
          )}
        </div>

        {/* Linked task info */}
        {linkedTaskId && (
          <div className="rounded-lg bg-info/10 border border-info/30 p-3">
            <p className="text-sm font-medium text-info">{t('detail.taskLinked')}</p>
            <p className="text-xs text-info/80 mt-1">{t('detail.taskId')}: {linkedTaskId}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">{t('detail.type')}</span>
              <p className="font-medium">{issue.issueType}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.status')}</span>
              <p className="font-medium">{issue.status}</p>
            </div>
            {issue.assignee && (
              <div>
                <span className="text-muted-foreground">{t('detail.assignee')}</span>
                <p className="font-medium">{issue.assignee}</p>
              </div>
            )}
            {issue.priority && (
              <div>
                <span className="text-muted-foreground">{t('detail.priority')}</span>
                <p className="font-medium">{issue.priority}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">{t('detail.created')}</span>
              <p className="font-medium">{formatDate(issue.created)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('detail.updated')}</span>
              <p className="font-medium">{formatDate(issue.updated)}</p>
            </div>
          </div>

          {/* Labels */}
          {issue.labels.length > 0 && (
            <div>
              <span className="text-sm text-muted-foreground">{t('detail.labels')}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {issue.labels.map((label) => (
                  <Badge key={label} variant="outline" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <h4 className="text-sm font-medium mb-2">{t('detail.description')}</h4>
          {issue.description ? (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/30 p-3">
              {issue.description}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">{t('detail.noDescription')}</p>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

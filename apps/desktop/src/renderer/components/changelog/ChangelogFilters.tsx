import { useTranslation } from 'react-i18next';
import { FileText, History, GitBranch, Tag, Calendar, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';
import type { ChangelogSourceMode, GitBranchInfo, GitTagInfo } from '../../../shared/types';

interface ChangelogFiltersProps {
  // Source mode
  sourceMode: ChangelogSourceMode;
  onSourceModeChange: (mode: ChangelogSourceMode) => void;
  // Task counts
  doneTasksCount: number;
  // Git data
  branches: GitBranchInfo[];
  tags: GitTagInfo[];
  defaultBranch: string;
  isLoadingGitData: boolean;
  isLoadingCommits: boolean;
  // Git history options
  gitHistoryType: 'recent' | 'since-date' | 'tag-range' | 'since-version';
  gitHistoryCount: number;
  gitHistorySinceDate: string;
  gitHistoryFromTag: string;
  gitHistoryToTag: string;
  gitHistorySinceVersion: string;
  includeMergeCommits: boolean;
  onGitHistoryTypeChange: (type: 'recent' | 'since-date' | 'tag-range' | 'since-version') => void;
  onGitHistoryCountChange: (count: number) => void;
  onGitHistorySinceDateChange: (date: string) => void;
  onGitHistoryFromTagChange: (tag: string) => void;
  onGitHistoryToTagChange: (tag: string) => void;
  onGitHistorySinceVersionChange: (version: string) => void;
  onIncludeMergeCommitsChange: (include: boolean) => void;
  // Branch diff options
  baseBranch: string;
  compareBranch: string;
  onBaseBranchChange: (branch: string) => void;
  onCompareBranchChange: (branch: string) => void;
  // Actions
  onLoadCommitsPreview: () => void;
}

export function ChangelogFilters({
  sourceMode,
  onSourceModeChange,
  doneTasksCount,
  branches,
  tags,
  defaultBranch,
  isLoadingGitData,
  isLoadingCommits,
  gitHistoryType,
  gitHistoryCount,
  gitHistorySinceDate,
  gitHistoryFromTag,
  gitHistoryToTag,
  gitHistorySinceVersion,
  includeMergeCommits,
  onGitHistoryTypeChange,
  onGitHistoryCountChange,
  onGitHistorySinceDateChange,
  onGitHistoryFromTagChange,
  onGitHistoryToTagChange,
  onGitHistorySinceVersionChange,
  onIncludeMergeCommitsChange,
  baseBranch,
  compareBranch,
  onBaseBranchChange,
  onCompareBranchChange,
  onLoadCommitsPreview
}: ChangelogFiltersProps) {
  const { t } = useTranslation('changelog');
  const localBranches = branches.filter((b) => !b.isRemote);

  return (
    <div className="w-80 shrink-0 border-e border-border overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Source Mode Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t('filters.source')}</Label>
          <RadioGroup
            value={sourceMode}
            onValueChange={(value) => onSourceModeChange(value as ChangelogSourceMode)}
            className="space-y-2"
          >
            <label
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all',
                sourceMode === 'tasks'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <RadioGroupItem value="tasks" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span className="font-medium text-sm">
                    {t('sourceModes.tasks.label')}
                  </span>
                  <Badge variant="secondary" className="ms-auto text-xs">
                    {doneTasksCount}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('sourceModes.tasks.description')}
                </p>
              </div>
            </label>

            <label
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all',
                sourceMode === 'git-history'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <RadioGroupItem value="git-history" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4" />
                  <span className="font-medium text-sm">
                    {t('sourceModes.git-history.label')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('sourceModes.git-history.description')}
                </p>
              </div>
            </label>

            <label
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-all',
                sourceMode === 'branch-diff'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <RadioGroupItem value="branch-diff" className="mt-1" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  <span className="font-medium text-sm">
                    {t('sourceModes.branch-diff.label')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('sourceModes.branch-diff.description')}
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* Git History Options */}
        {sourceMode === 'git-history' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('filters.gitHistoryOptions')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* History Type */}
              <div className="space-y-2">
                <Label className="text-xs">{t('filters.historyType')}</Label>
                <Select
                  value={gitHistoryType}
                  onValueChange={(v) => onGitHistoryTypeChange(v as 'recent' | 'since-date' | 'tag-range' | 'since-version')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="since-version">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3 w-3" />
                        {t('filters.historyTypeOptions.sinceVersion')}
                      </div>
                    </SelectItem>
                    <SelectItem value="recent">
                      <div className="flex items-center gap-2">
                        <History className="h-3 w-3" />
                        {t('filters.historyTypeOptions.recentCommits')}
                      </div>
                    </SelectItem>
                    <SelectItem value="since-date">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        {t('filters.historyTypeOptions.sinceDate')}
                      </div>
                    </SelectItem>
                    <SelectItem value="tag-range">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3 w-3" />
                        {t('filters.historyTypeOptions.tagRange')}
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Type-specific options */}
              {gitHistoryType === 'recent' && (
                <div className="space-y-2">
                  <Label className="text-xs">{t('filters.numberOfCommits')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={gitHistoryCount}
                    onChange={(e) => onGitHistoryCountChange(parseInt(e.target.value, 10) || 25)}
                  />
                </div>
              )}

              {gitHistoryType === 'since-date' && (
                <div className="space-y-2">
                  <Label className="text-xs">{t('filters.sinceDate')}</Label>
                  <Input
                    type="date"
                    value={gitHistorySinceDate}
                    onChange={(e) => onGitHistorySinceDateChange(e.target.value)}
                  />
                </div>
              )}

              {gitHistoryType === 'tag-range' && (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs">{t('filters.fromTag')}</Label>
                    <Select value={gitHistoryFromTag} onValueChange={onGitHistoryFromTagChange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('filters.selectTagPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {tags.map((tag) => (
                          <SelectItem key={tag.name} value={tag.name}>
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">{t('filters.toTagOptional')}</Label>
                    <Select value={gitHistoryToTag || 'HEAD'} onValueChange={(v) => onGitHistoryToTagChange(v === 'HEAD' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('filters.headLatest')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HEAD">{t('filters.headLatest')}</SelectItem>
                        {tags.map((tag) => (
                          <SelectItem key={tag.name} value={tag.name}>
                            {tag.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {gitHistoryType === 'since-version' && (
                <div className="space-y-2">
                  <Label className="text-xs">{t('filters.lastVersion')}</Label>
                  <Select value={gitHistorySinceVersion} onValueChange={onGitHistorySinceVersionChange}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('filters.selectVersionPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {tags.map((tag) => (
                        <SelectItem key={tag.name} value={tag.name}>
                          {tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t('filters.sinceVersionHint')}
                  </p>
                </div>
              )}

              {/* Include merge commits */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="merge-commits"
                  checked={includeMergeCommits}
                  onCheckedChange={(checked) => onIncludeMergeCommitsChange(checked as boolean)}
                />
                <Label htmlFor="merge-commits" className="text-xs cursor-pointer">
                  {t('filters.includeMergeCommits')}
                </Label>
              </div>

              {/* Load Preview Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={onLoadCommitsPreview}
                disabled={isLoadingCommits || isLoadingGitData}
              >
                {isLoadingCommits ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('actions.loading')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="me-2 h-4 w-4" />
                    {t('actions.loadCommits')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Branch Diff Options */}
        {sourceMode === 'branch-diff' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('filters.branchComparison')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">{t('filters.baseBranch')}</Label>
                <Select value={baseBranch} onValueChange={onBaseBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('filters.selectBaseBranchPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {localBranches.map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        <div className="flex items-center gap-2">
                          {branch.name}
                          {branch.name === defaultBranch && (
                            <Badge variant="outline" className="text-xs">{t('filters.defaultBadge')}</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('filters.baseBranchHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">{t('filters.compareBranch')}</Label>
                <Select value={compareBranch} onValueChange={onCompareBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('filters.selectCompareBranchPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {localBranches.map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        <div className="flex items-center gap-2">
                          {branch.name}
                          {branch.isCurrent && (
                            <Badge variant="secondary" className="text-xs">{t('filters.currentBadge')}</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('filters.compareBranchHint')}
                </p>
              </div>

              {baseBranch && compareBranch && baseBranch === compareBranch && (
                <div className="flex items-center gap-2 text-destructive text-xs">
                  <AlertCircle className="h-3 w-3" />
                  {t('filters.branchesMustDiffer')}
                </div>
              )}

              {/* Load Preview Button */}
              <Button
                variant="outline"
                className="w-full"
                onClick={onLoadCommitsPreview}
                disabled={isLoadingCommits || isLoadingGitData || !baseBranch || !compareBranch || baseBranch === compareBranch}
              >
                {isLoadingCommits ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('actions.loading')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="me-2 h-4 w-4" />
                    {t('actions.loadCommits')}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

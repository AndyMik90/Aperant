import { FileText, History, GitBranch, Tag, Calendar, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  CHANGELOG_SOURCE_MODE_LABELS,
  CHANGELOG_SOURCE_MODE_DESCRIPTIONS
} from '../../../shared/constants';
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
  const localBranches = branches.filter((b) => !b.isRemote);

  return (
    <div className="w-80 shrink-0 border-r border-border overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Source Mode Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">Changelog Source</Label>
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
                    {CHANGELOG_SOURCE_MODE_LABELS['tasks']}
                  </span>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {doneTasksCount}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {CHANGELOG_SOURCE_MODE_DESCRIPTIONS['tasks']}
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
                    {CHANGELOG_SOURCE_MODE_LABELS['git-history']}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {CHANGELOG_SOURCE_MODE_DESCRIPTIONS['git-history']}
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
                    {CHANGELOG_SOURCE_MODE_LABELS['branch-diff']}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {CHANGELOG_SOURCE_MODE_DESCRIPTIONS['branch-diff']}
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* Git History Options */}
        {sourceMode === 'git-history' && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Git History Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* History Type */}
              <div className="space-y-2">
                <Label className="text-xs">History Type</Label>
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
                        Since Version
                      </div>
                    </SelectItem>
                    <SelectItem value="recent">
                      <div className="flex items-center gap-2">
                        <History className="h-3 w-3" />
                        Recent Commits
                      </div>
                    </SelectItem>
                    <SelectItem value="since-date">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3 w-3" />
                        Since Date
                      </div>
                    </SelectItem>
                    <SelectItem value="tag-range">
                      <div className="flex items-center gap-2">
                        <Tag className="h-3 w-3" />
                        Tag Range
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Type-specific options */}
              {gitHistoryType === 'recent' && (
                <div className="space-y-2">
                  <Label className="text-xs">Number of Commits</Label>
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
                  <Label className="text-xs">Since Date</Label>
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
                    <Label className="text-xs">From Tag</Label>
                    <Select value={gitHistoryFromTag} onValueChange={onGitHistoryFromTagChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select tag..." />
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
                    <Label className="text-xs">To Tag (optional)</Label>
                    <Select value={gitHistoryToTag || 'HEAD'} onValueChange={(v) => onGitHistoryToTagChange(v === 'HEAD' ? '' : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="HEAD (latest)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HEAD">HEAD (latest)</SelectItem>
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
                  <Label className="text-xs">Last Version</Label>
                  <Select value={gitHistorySinceVersion} onValueChange={onGitHistorySinceVersionChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select version..." />
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
                    All commits since this version will be included
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
                  Include merge commits
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Load Commits
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
              <CardTitle className="text-sm">Branch Comparison</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs">Base Branch</Label>
                <Select value={baseBranch} onValueChange={onBaseBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select base branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {localBranches.map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        <div className="flex items-center gap-2">
                          {branch.name}
                          {branch.name === defaultBranch && (
                            <Badge variant="outline" className="text-xs">default</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The branch you're merging into
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Compare Branch</Label>
                <Select value={compareBranch} onValueChange={onCompareBranchChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select compare branch..." />
                  </SelectTrigger>
                  <SelectContent>
                    {localBranches.map((branch) => (
                      <SelectItem key={branch.name} value={branch.name}>
                        <div className="flex items-center gap-2">
                          {branch.name}
                          {branch.isCurrent && (
                            <Badge variant="secondary" className="text-xs">current</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  The branch with your changes
                </p>
              </div>

              {baseBranch && compareBranch && baseBranch === compareBranch && (
                <div className="flex items-center gap-2 text-destructive text-xs">
                  <AlertCircle className="h-3 w-3" />
                  Branches must be different
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
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Load Commits
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

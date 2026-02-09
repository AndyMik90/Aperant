import { useState, useMemo } from 'react';
import {
  RefreshCw,
  Database,
  Brain,
  Search,
  CheckCircle,
  XCircle,
  GitPullRequest,
  Lightbulb,
  FolderTree,
  Code,
  AlertTriangle
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { MemoryCard } from './MemoryCard';
import { InfoItem } from './InfoItem';
import { memoryFilterCategories } from './constants';
import type { GraphitiMemoryStatus, GraphitiMemoryState, MemoryEpisode } from '../../../shared/types';

type FilterCategory = keyof typeof memoryFilterCategories;

interface MemoriesTabProps {
  memoryStatus: GraphitiMemoryStatus | null;
  memoryState: GraphitiMemoryState | null;
  recentMemories: MemoryEpisode[];
  memoriesLoading: boolean;
  searchResults: Array<{ type: string; content: string; score: number }>;
  searchLoading: boolean;
  onSearch: (query: string) => void;
}

// Helper to check if memory is a PR review (by type or content)
function isPRReview(memory: MemoryEpisode): boolean {
  if (['pr_review', 'pr_finding', 'pr_pattern', 'pr_gotcha'].includes(memory.type)) {
    return true;
  }
  try {
    const parsed = JSON.parse(memory.content);
    return parsed.prNumber !== undefined && parsed.verdict !== undefined;
  } catch {
    return false;
  }
}

// Get the effective category for a memory
function getMemoryCategory(memory: MemoryEpisode): FilterCategory {
  if (isPRReview(memory)) return 'pr';
  if (['session_insight', 'task_outcome'].includes(memory.type)) return 'sessions';
  if (['codebase_discovery', 'codebase_map'].includes(memory.type)) return 'codebase';
  if (['pattern', 'pr_pattern'].includes(memory.type)) return 'patterns';
  if (['gotcha', 'pr_gotcha'].includes(memory.type)) return 'gotchas';
  return 'sessions'; // default
}

// Filter icons for each category
const filterIcons: Record<FilterCategory, React.ElementType> = {
  all: Brain,
  pr: GitPullRequest,
  sessions: Lightbulb,
  codebase: FolderTree,
  patterns: Code,
  gotchas: AlertTriangle
};

export function MemoriesTab({
  memoryStatus,
  memoryState,
  recentMemories,
  memoriesLoading,
  searchResults,
  searchLoading,
  onSearch
}: MemoriesTabProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');

  // Calculate memory counts by category
  const memoryCounts = useMemo(() => {
    const counts: Record<FilterCategory, number> = {
      all: recentMemories.length,
      pr: 0,
      sessions: 0,
      codebase: 0,
      patterns: 0,
      gotchas: 0
    };

    for (const memory of recentMemories) {
      const category = getMemoryCategory(memory);
      counts[category]++;
    }

    return counts;
  }, [recentMemories]);

  // Filter memories based on active filter
  const filteredMemories = useMemo(() => {
    if (activeFilter === 'all') return recentMemories;
    return recentMemories.filter(memory => getMemoryCategory(memory) === activeFilter);
  }, [recentMemories, activeFilter]);

  const handleSearch = () => {
    if (localSearchQuery.trim()) {
      onSearch(localSearchQuery);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <ScrollArea className="h-full">
      <div className="p-6 space-y-6">
        {/* Memory Status */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4" />
                Graph Memory Status
              </CardTitle>
              {memoryStatus?.available ? (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-muted text-muted-foreground">
                  <XCircle className="h-3 w-3 mr-1" />
                  Not Available
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {memoryStatus?.available ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <InfoItem label="Database" value={memoryStatus.database || 'ac_jerry_memory'} />
                  <InfoItem label="Path" value={memoryStatus.dbPath || '~/.ac.jerry/memories'} />
                </div>

                {/* Memory Stats Summary */}
                {recentMemories.length > 0 && (
                  <div className="pt-3 border-t border-border/50">
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <div className="text-lg font-semibold text-foreground">{memoryCounts.all}</div>
                        <div className="text-xs text-muted-foreground">Total</div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-cyan-500/10">
                        <div className="text-lg font-semibold text-cyan-400">{memoryCounts.pr}</div>
                        <div className="text-xs text-muted-foreground">PR Reviews</div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-amber-500/10">
                        <div className="text-lg font-semibold text-amber-400">{memoryCounts.sessions}</div>
                        <div className="text-xs text-muted-foreground">Sessions</div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-blue-500/10">
                        <div className="text-lg font-semibold text-blue-400">{memoryCounts.codebase}</div>
                        <div className="text-xs text-muted-foreground">Codebase</div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-purple-500/10">
                        <div className="text-lg font-semibold text-purple-400">{memoryCounts.patterns}</div>
                        <div className="text-xs text-muted-foreground">Patterns</div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-red-500/10">
                        <div className="text-lg font-semibold text-red-400">{memoryCounts.gotchas}</div>
                        <div className="text-xs text-muted-foreground">Gotchas</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>{memoryStatus?.reason || 'Graphiti memory is not configured'}</p>
                <p className="mt-2 text-xs">
                  To enable graph memory, set <code className="bg-muted px-1 py-0.5 rounded">GRAPHITI_ENABLED=true</code> in project settings.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Search Memories
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="Search for patterns, insights, gotchas..."
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <Button onClick={handleSearch} disabled={searchLoading}>
              <Search className={cn('h-4 w-4', searchLoading && 'animate-pulse')} />
            </Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
              </p>
              {searchResults.map((result, idx) => (
                <Card key={idx} className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-xs capitalize">
                        {result.type.replace('_', ' ')}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Score: {result.score.toFixed(2)}
                      </span>
                    </div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono max-h-40 overflow-auto">
                      {result.content}
                    </pre>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Memory Browser */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Memory Browser
            </h3>
            <span className="text-xs text-muted-foreground">
              {filteredMemories.length} of {recentMemories.length} memories
            </span>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {(Object.keys(memoryFilterCategories) as FilterCategory[]).map((category) => {
              const config = memoryFilterCategories[category];
              const count = memoryCounts[category];
              const Icon = filterIcons[category];
              const isActive = activeFilter === category;

              return (
                <Button
                  key={category}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'gap-1.5 h-8',
                    isActive && 'bg-accent text-accent-foreground',
                    !isActive && count === 0 && 'opacity-50'
                  )}
                  onClick={() => setActiveFilter(category)}
                  disabled={count === 0 && category !== 'all'}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{config.label}</span>
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'ml-1 px-1.5 py-0 text-xs',
                        isActive && 'bg-background/20'
                      )}
                    >
                      {count}
                    </Badge>
                  )}
                </Button>
              );
            })}
          </div>

          {/* Memory List */}
          {memoriesLoading && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {!memoriesLoading && filteredMemories.length === 0 && recentMemories.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Brain className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories recorded yet. Memories are created during AI agent sessions and PR reviews.
              </p>
            </div>
          )}

          {!memoriesLoading && filteredMemories.length === 0 && recentMemories.length > 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Brain className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">
                No memories match the selected filter.
              </p>
              <Button
                variant="link"
                size="sm"
                onClick={() => setActiveFilter('all')}
                className="mt-2"
              >
                Show all memories
              </Button>
            </div>
          )}

          {filteredMemories.length > 0 && (
            <div className="space-y-3">
              {filteredMemories.map((memory) => (
                <MemoryCard key={memory.id} memory={memory} />
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

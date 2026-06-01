import { useState, useMemo } from 'react';
import {
  RefreshCw,
  Database,
  Brain,
  Search,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Bug,
  Sparkles,
  RefreshCcw,
  BookOpen,
  BarChart2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import { MemoryCard } from './MemoryCard';
import { InfoItem } from './InfoItem';
import { memoryFilterCategories, type MemoryFilterCategory } from './constants';
import type { MemorySystemStatus, MemorySystemState, RendererMemory } from '../../../shared/types';

interface MemoriesTabProps {
  memoryStatus: MemorySystemStatus | null;
  memoryState: MemorySystemState | null;
  recentMemories: RendererMemory[];
  memoriesLoading: boolean;
  searchResults: Array<{ type: string; content: string; score: number }>;
  searchLoading: boolean;
  onSearch: (query: string) => void;
  onVerify?: (memoryId: string) => void;
  onPin?: (memoryId: string, pinned: boolean) => void;
  onDeprecate?: (memoryId: string) => void;
}

// Get the effective category for a memory based on its type
function getMemoryCategory(memory: RendererMemory): MemoryFilterCategory {
  const type = memory.type;

  // Patterns
  if (['pattern', 'workflow_recipe', 'prefetch_pattern'].includes(type)) return 'patterns';

  // Errors & Gotchas
  if (['error_pattern', 'dead_end', 'gotcha'].includes(type)) return 'errors';

  // Decisions
  if (['decision', 'preference', 'requirement'].includes(type)) return 'decisions';

  // Code Insights
  if (['module_insight', 'causal_dependency', 'e2e_observation'].includes(type)) return 'insights';

  // Calibration
  if (['task_calibration', 'work_unit_outcome', 'work_state', 'context_cost'].includes(type))
    return 'calibration';

  return 'calibration'; // default
}

// Filter icons for each category key
const filterIcons: Record<MemoryFilterCategory, React.ElementType> = {
  all: Brain,
  patterns: RefreshCcw,
  errors: AlertTriangle,
  decisions: Sparkles,
  insights: Bug,
  calibration: BarChart2
};

export function MemoriesTab({
  memoryStatus,
  memoryState,
  recentMemories,
  memoriesLoading,
  searchResults,
  searchLoading,
  onSearch,
  onVerify,
  onPin,
  onDeprecate
}: MemoriesTabProps) {
  const { t } = useTranslation('common');
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<MemoryFilterCategory>('all');

  // Calculate memory counts by category
  const memoryCounts = useMemo(() => {
    const counts: Record<MemoryFilterCategory, number> = {
      all: recentMemories.length,
      patterns: 0,
      errors: 0,
      decisions: 0,
      insights: 0,
      calibration: 0
    };

    for (const memory of recentMemories) {
      const category = getMemoryCategory(memory);
      counts[category]++;
    }

    return counts;
  }, [recentMemories]);

  // Memory health metrics
  const memoryHealth = useMemo(() => {
    if (recentMemories.length === 0) return null;
    const avgConfidence =
      recentMemories.reduce((sum, m) => sum + (m.confidence ?? 0), 0) / recentMemories.length;
    const verifiedCount = recentMemories.filter((m) => m.userVerified).length;
    return {
      avgConfidence: Math.round(avgConfidence * 100),
      verifiedCount,
      verifiedPct: Math.round((verifiedCount / recentMemories.length) * 100)
    };
  }, [recentMemories]);

  // Filter memories based on active filter
  const filteredMemories = useMemo(() => {
    if (activeFilter === 'all') return recentMemories;
    return recentMemories.filter((memory) => getMemoryCategory(memory) === activeFilter);
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
                {t('memory.status.title')}
              </CardTitle>
              {memoryStatus?.available ? (
                <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                  <CheckCircle className="h-3 w-3 me-1" />
                  {t('memory.status.connected')}
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-muted text-muted-foreground">
                  <XCircle className="h-3 w-3 me-1" />
                  {t('memory.status.notAvailable')}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {memoryStatus?.available ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 text-sm">
                  <InfoItem label={t('memory.info.database')} value={memoryStatus.database || 'auto_claude_memory'} />
                  <InfoItem label={t('memory.info.path')} value={memoryStatus.dbPath || '~/.auto-claude/memories'} />
                  {memoryStatus.embeddingProvider && (
                    <InfoItem label={t('memory.info.embedding')} value={memoryStatus.embeddingProvider} />
                  )}
                  {memoryState && (
                    <InfoItem label={t('memory.info.memories')} value={String(memoryState.episodeCount)} />
                  )}
                </div>

                {/* Memory Health Indicator */}
                {memoryHealth && recentMemories.length > 0 && (
                  <div className="pt-3 border-t border-border/50">
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <div className="text-lg font-semibold text-foreground">
                          {recentMemories.length}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.health.totalMemories')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-blue-500/10">
                        <div className="text-lg font-semibold text-blue-400">
                          {memoryHealth.avgConfidence}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.health.avgConfidence')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-green-500/10">
                        <div className="text-lg font-semibold text-green-400">
                          {memoryHealth.verifiedPct}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.health.verified')}
                        </div>
                      </div>
                    </div>

                    {/* Category counts */}
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                      <div className="text-center p-2 rounded-lg bg-muted/30">
                        <div className="text-lg font-semibold text-foreground">
                          {memoryCounts.all}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.all')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-purple-500/10">
                        <div className="text-lg font-semibold text-purple-400">
                          {memoryCounts.patterns}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.patterns')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-red-500/10">
                        <div className="text-lg font-semibold text-red-400">
                          {memoryCounts.errors}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.errors')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-cyan-500/10">
                        <div className="text-lg font-semibold text-cyan-400">
                          {memoryCounts.decisions}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.decisions')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-yellow-500/10">
                        <div className="text-lg font-semibold text-yellow-400">
                          {memoryCounts.insights}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.insights')}
                        </div>
                      </div>
                      <div className="text-center p-2 rounded-lg bg-green-500/10">
                        <div className="text-lg font-semibold text-green-400">
                          {memoryCounts.calibration}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('memory.filters.calibration')}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>{memoryStatus?.reason || t('memory.status.notConfigured')}</p>
                <p className="mt-2 text-xs">{t('memory.status.enableInSettings')}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Search */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {t('memory.search.title')}
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder={t('memory.search.placeholder')}
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
                {t('memory.search.resultsCount', { count: searchResults.length })}
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
              {t('memory.browser.title')}
            </h3>
            <span className="text-xs text-muted-foreground">
              {t('memory.browser.countOf', {
                filtered: filteredMemories.length,
                total: recentMemories.length
              })}
            </span>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {memoryFilterCategories.map((category) => {
              const count = memoryCounts[category.key];
              const Icon = filterIcons[category.key];
              const isActive = activeFilter === category.key;
              const filterLabel = t(`memory.filters.${category.key}`, {
                defaultValue: category.label
              });

              return (
                <Button
                  key={category.key}
                  variant={isActive ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'gap-1.5 h-8',
                    isActive && 'bg-accent text-accent-foreground',
                    !isActive && count === 0 && 'opacity-50'
                  )}
                  onClick={() => setActiveFilter(category.key)}
                  disabled={count === 0 && category.key !== 'all'}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{filterLabel}</span>
                  {count > 0 && (
                    <Badge
                      variant="secondary"
                      className={cn('ms-1 px-1.5 py-0 text-xs', isActive && 'bg-background/20')}
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

          {!memoriesLoading &&
            filteredMemories.length === 0 &&
            recentMemories.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Brain className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">{t('memory.empty')}</p>
              </div>
            )}

          {!memoriesLoading &&
            filteredMemories.length === 0 &&
            recentMemories.length > 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Brain className="h-10 w-10 text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">{t('memory.emptyFilter')}</p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setActiveFilter('all')}
                  className="mt-2"
                >
                  {t('memory.showAll')}
                </Button>
              </div>
            )}

          {filteredMemories.length > 0 && (
            <div className="space-y-3">
              {filteredMemories.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  onVerify={onVerify}
                  onPin={onPin}
                  onDeprecate={onDeprecate}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}

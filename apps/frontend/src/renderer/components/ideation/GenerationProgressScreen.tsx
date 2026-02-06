import { useEffect, useRef, useState } from 'react';
import { Sparkles, FileCode, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { ScrollArea } from '../ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  IDEATION_TYPE_LABELS,
  IDEATION_TYPE_COLORS
} from '../../../shared/constants';
import type {
  Idea,
  IdeationType,
  IdeationGenerationStatus,
  IdeationSession
} from '../../../shared/types';
import type { IdeationTypeState } from '../../stores/ideation-store';
import { TypeIcon } from './TypeIcon';
import { TypeStateIcon } from './TypeStateIcon';
import { IdeaSkeletonCard } from './IdeaSkeletonCard';
import { IdeaCard } from './IdeaCard';
import { IdeaDetailPanel } from './IdeaDetailPanel';

interface GenerationProgressScreenProps {
  generationStatus: IdeationGenerationStatus;
  logs: string[];
  typeStates: Record<IdeationType, IdeationTypeState>;
  enabledTypes: IdeationType[];
  session: IdeationSession | null;
  onSelectIdea: (idea: Idea | null) => void;
  selectedIdea: Idea | null;
  onConvert: (idea: Idea) => void;
  onGoToTask?: (taskId: string) => void;
  onDismiss: (idea: Idea) => void;
  onStop: () => void | Promise<void>;
}

export function GenerationProgressScreen({
  generationStatus,
  logs,
  typeStates,
  enabledTypes,
  session,
  onSelectIdea,
  selectedIdea,
  onConvert,
  onGoToTask,
  onDismiss,
  onStop
}: GenerationProgressScreenProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  /**
   * Handle stop button click with error handling and double-click prevention
   */
  const handleStopClick = async () => {
    if (isStopping) return;

    setIsStopping(true);
    try {
      await onStop();
    } catch (err) {
      console.error('Failed to stop generation:', err);
    } finally {
      setIsStopping(false);
    }
  };

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    if (logsEndRef.current && showLogs) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [showLogs]);

  const getStreamingIdeasByType = (type: IdeationType): Idea[] => {
    if (!session) return [];
    return session.ideas.filter(
      (idea) => idea.type === type && idea.status !== 'dismissed' && idea.status !== 'archived'
    );
  };

  // Count how many types are still generating
  const _generatingCount = enabledTypes.filter((t) => typeStates[t] === 'generating').length;
  const completedCount = enabledTypes.filter((t) => typeStates[t] === 'completed').length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-4 bg-card/50">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-5 w-5 text-primary animate-pulse" />
              <h2 className="text-lg font-semibold">Generating Ideas</h2>
              <Badge variant="outline">
                {completedCount}/{enabledTypes.length} complete
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{generationStatus.message}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLogs(!showLogs)}
            >
              <FileCode className="h-4 w-4 mr-1" />
              {showLogs ? 'Hide' : 'Show'} Logs
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStopClick}
                  disabled={isStopping}
                >
                  <Square className="h-4 w-4 mr-1" />
                  {isStopping ? 'Stopping...' : 'Stop'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop generation</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <Progress value={generationStatus.progress} className="mt-3" />

        {/* Type Status Indicators */}
        <div className="mt-3 flex flex-wrap gap-2">
          {enabledTypes.map((type) => (
            <div
              key={type}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs ${
                typeStates[type] === 'completed'
                  ? 'bg-success/10 text-success'
                  : typeStates[type] === 'failed'
                    ? 'bg-destructive/10 text-destructive'
                    : typeStates[type] === 'generating'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
              }`}
            >
              <TypeStateIcon state={typeStates[type]} />
              <TypeIcon type={type} />
              <span>{IDEATION_TYPE_LABELS[type]}</span>
              {typeStates[type] === 'completed' && session && (
                <span className="ml-1 font-medium">
                  ({getStreamingIdeasByType(type).length})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Logs Panel (collapsible) */}
      {showLogs && logs.length > 0 && (
        <div className="shrink-0 border-b border-border p-4 bg-muted/20">
          <ScrollArea className="h-32 rounded-md border border-border bg-muted/30">
            <div className="p-3 space-y-1 font-mono text-xs">
              {logs.map((log, index) => (
                <div key={index} className="text-muted-foreground leading-relaxed">
                  <span className="text-muted-foreground/50 mr-2 select-none">
                    {String(index + 1).padStart(3, '0')}
                  </span>
                  {log}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Streaming Ideas View */}
      <div className="flex-1 overflow-auto p-4">
        {generationStatus.error && (
          <div className="mb-4 p-3 bg-destructive/10 rounded-md text-destructive text-sm">
            {generationStatus.error}
          </div>
        )}

        <div className="space-y-6">
          {enabledTypes.map((type) => {
            const ideas = getStreamingIdeasByType(type);
            const state = typeStates[type];

            return (
              <div key={type}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`p-1.5 rounded-md ${IDEATION_TYPE_COLORS[type]}`}>
                    <TypeIcon type={type} />
                  </div>
                  <h3 className="font-medium">{IDEATION_TYPE_LABELS[type]}</h3>
                  <TypeStateIcon state={state} />
                  {ideas.length > 0 && (
                    <Badge variant="outline" className="ml-auto">
                      {ideas.length} ideas
                    </Badge>
                  )}
                </div>

                <div className="grid gap-3">
                  {/* Show actual ideas if available */}
                  {ideas.map((idea) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      isSelected={false}
                      onClick={() => onSelectIdea(selectedIdea?.id === idea.id ? null : idea)}
                      onConvert={onConvert}
                      onGoToTask={onGoToTask}
                      onDismiss={onDismiss}
                      onToggleSelect={() => {/* Selection disabled during generation */}}
                    />
                  ))}

                  {/* Show skeleton placeholders while generating */}
                  {state === 'generating' && (
                    <>
                      <IdeaSkeletonCard />
                      <IdeaSkeletonCard />
                    </>
                  )}

                  {/* Show pending message */}
                  {state === 'pending' && (
                    <div className="text-sm text-muted-foreground py-2">
                      Waiting to start...
                    </div>
                  )}

                  {/* Show failed message */}
                  {state === 'failed' && ideas.length === 0 && (
                    <div className="text-sm text-destructive py-2">
                      Failed to generate ideas for this category
                    </div>
                  )}

                  {/* Show empty message if completed with no ideas */}
                  {state === 'completed' && ideas.length === 0 && (
                    <div className="text-sm text-muted-foreground py-2">
                      No ideas generated for this category
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Idea Detail Panel */}
      {selectedIdea && (
        <IdeaDetailPanel
          idea={selectedIdea}
          onClose={() => onSelectIdea(null)}
          onConvert={onConvert}
          onGoToTask={onGoToTask}
          onDismiss={onDismiss}
        />
      )}
    </div>
  );
}

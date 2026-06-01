import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Users,
  Play,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Progress } from '../../ui/progress';
import { ScrollArea } from '../../ui/scroll-area';
import { Checkbox } from '../../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../ui/collapsible';
import type {
  AnalyzePreviewResult,
  AnalyzePreviewProgress,
  ProposedBatch
} from '../../../../preload/api/modules/github-api';

interface BatchReviewWizardProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onStartAnalysis: () => void;
  onApproveBatches: (batches: ProposedBatch[]) => Promise<void>;
  analysisProgress: AnalyzePreviewProgress | null;
  analysisResult: AnalyzePreviewResult | null;
  analysisError: string | null;
  isAnalyzing: boolean;
  isApproving: boolean;
}

export function BatchReviewWizard({
  isOpen,
  onClose,
  projectId,
  onStartAnalysis,
  onApproveBatches,
  analysisProgress,
  analysisResult,
  analysisError,
  isAnalyzing,
  isApproving,
}: BatchReviewWizardProps) {
  // Track which batches are selected for approval
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(new Set());
  // Track which single issues are selected for approval
  const [selectedSingleIssueNumbers, setSelectedSingleIssueNumbers] = useState<Set<number>>(new Set());
  // Track which batches are expanded
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<number>>(new Set());
  // Current wizard step
  const [step, setStep] = useState<'intro' | 'analyzing' | 'review' | 'approving' | 'done'>('intro');

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedBatchIds(new Set());
      setSelectedSingleIssueNumbers(new Set());
      setExpandedBatchIds(new Set());
      setStep('intro');
    }
  }, [isOpen]);

  // Update step based on analysis state
  useEffect(() => {
    if (isAnalyzing) {
      setStep('analyzing');
    } else if (analysisResult) {
      setStep('review');
      // Select all validated batches by default
      const validatedIds = new Set(
        analysisResult.proposedBatches
          .filter(b => b.validated)
          .map((_, idx) => idx)
      );
      setSelectedBatchIds(validatedIds);
      // If no batches, auto-select all single issues
      if (analysisResult.proposedBatches.length === 0 && analysisResult.singleIssues.length > 0) {
        const singleIssueNumbers = new Set(
          analysisResult.singleIssues.map(issue => issue.issueNumber)
        );
        setSelectedSingleIssueNumbers(singleIssueNumbers);
      }
    } else if (analysisError) {
      setStep('intro');
    }
  }, [isAnalyzing, analysisResult, analysisError]);

  // Update step when approving
  useEffect(() => {
    if (isApproving) {
      setStep('approving');
    }
  }, [isApproving]);

  const toggleBatchSelection = useCallback((batchIndex: number) => {
    setSelectedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(batchIndex)) {
        next.delete(batchIndex);
      } else {
        next.add(batchIndex);
      }
      return next;
    });
  }, []);

  const toggleSingleIssueSelection = useCallback((issueNumber: number) => {
    setSelectedSingleIssueNumbers(prev => {
      const next = new Set(prev);
      if (next.has(issueNumber)) {
        next.delete(issueNumber);
      } else {
        next.add(issueNumber);
      }
      return next;
    });
  }, []);

  const toggleBatchExpanded = useCallback((batchIndex: number) => {
    setExpandedBatchIds(prev => {
      const next = new Set(prev);
      if (next.has(batchIndex)) {
        next.delete(batchIndex);
      } else {
        next.add(batchIndex);
      }
      return next;
    });
  }, []);

  const selectAllBatches = useCallback(() => {
    if (!analysisResult) return;
    const allIds = new Set(analysisResult.proposedBatches.map((_, idx) => idx));
    setSelectedBatchIds(allIds);
    const allSingleIssues = new Set(analysisResult.singleIssues.map(issue => issue.issueNumber));
    setSelectedSingleIssueNumbers(allSingleIssues);
  }, [analysisResult]);

  const deselectAllBatches = useCallback(() => {
    setSelectedBatchIds(new Set());
    setSelectedSingleIssueNumbers(new Set());
  }, []);

  const handleApprove = useCallback(async () => {
    if (!analysisResult) return;

    // Get selected batches
    const selectedBatches = analysisResult.proposedBatches.filter(
      (_, idx) => selectedBatchIds.has(idx)
    );

    // Convert selected single issues into batches (each single issue becomes a batch of 1)
    const selectedSingleIssueBatches: ProposedBatch[] = analysisResult.singleIssues
      .filter(issue => selectedSingleIssueNumbers.has(issue.issueNumber))
      .map(issue => ({
        primaryIssue: issue.issueNumber,
        issues: [{
          issueNumber: issue.issueNumber,
          title: issue.title,
          labels: issue.labels,
          similarityToPrimary: 1.0
        }],
        issueCount: 1,
        commonThemes: [],
        validated: true,
        confidence: 1.0,
        reasoning: 'Single issue - not grouped with others',
        theme: issue.title
      }));

    // Combine batches and single issues
    const allBatches = [...selectedBatches, ...selectedSingleIssueBatches];

    await onApproveBatches(allBatches);
    setStep('done');
  }, [analysisResult, selectedBatchIds, selectedSingleIssueNumbers, onApproveBatches]);

  const renderIntro = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-6">
      <div className="p-4 rounded-full bg-primary/10">
        <Layers className="h-12 w-12 text-primary" />
      </div>
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Analyze & Group Issues</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          This will analyze up to 200 open issues, group similar ones together,
          and let you review the proposed batches before creating any tasks.
        </p>
      </div>
      {analysisError && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{analysisError}</span>
        </div>
      )}
      <Button onClick={onStartAnalysis} size="lg">
        <Layers className="h-4 w-4 me-2" />
        Start Analysis
      </Button>
    </div>
  );

  const renderAnalyzing = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-6">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Analyzing Issues...</h3>
        <p className="text-sm text-muted-foreground">
          {analysisProgress?.message || 'Computing similarity and validating batches...'}
        </p>
      </div>
      <div className="w-full max-w-md">
        <Progress value={analysisProgress?.progress ?? 0} />
        <p className="text-xs text-center text-muted-foreground mt-2">
          {analysisProgress?.progress ?? 0}% complete
        </p>
      </div>
    </div>
  );

  const renderReview = () => {
    if (!analysisResult) return null;

    const { proposedBatches, singleIssues, totalIssues } = analysisResult;
    const selectedCount = selectedBatchIds.size;
    const totalIssuesInSelected = proposedBatches
      .filter((_, idx) => selectedBatchIds.has(idx))
      .reduce((sum, b) => sum + b.issueCount, 0);

    return (
      <div className="flex flex-col h-[60vh]">
        {/* Stats Bar */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg mb-4">
          <div className="flex items-center gap-4 text-sm">
            <span>
              <strong>{totalIssues}</strong> issues analyzed
            </span>
            <span className="text-muted-foreground">|</span>
            <span>
              <strong>{proposedBatches.length}</strong> batches proposed
            </span>
            <span className="text-muted-foreground">|</span>
            <span>
              <strong>{singleIssues.length}</strong> single issues
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={selectAllBatches}>
              Select All
            </Button>
            <Button variant="ghost" size="sm" onClick={deselectAllBatches}>
              Deselect All
            </Button>
          </div>
        </div>

        {/* Batches List */}
        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-3">
            {proposedBatches.map((batch, idx) => (
              <BatchCard
                key={idx}
                batch={batch}
                index={idx}
                isSelected={selectedBatchIds.has(idx)}
                isExpanded={expandedBatchIds.has(idx)}
                onToggleSelect={() => toggleBatchSelection(idx)}
                onToggleExpand={() => toggleBatchExpanded(idx)}
              />
            ))}
          </div>

          {/* Single Issues Section */}
          {singleIssues.length > 0 && (
            <div className="mt-6">
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Single Issues (not grouped)
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {singleIssues.slice(0, 10).map((issue) => (
                  <div
                    key={issue.issueNumber}
                    onClick={() => toggleSingleIssueSelection(issue.issueNumber)}
                    className={`p-2 rounded border text-sm truncate cursor-pointer transition-colors ${
                      selectedSingleIssueNumbers.has(issue.issueNumber)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    <Checkbox
                      checked={selectedSingleIssueNumbers.has(issue.issueNumber)}
                      className="inline-block me-2"
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={() => toggleSingleIssueSelection(issue.issueNumber)}
                    />
                    <span className="text-muted-foreground">#{issue.issueNumber}</span>{' '}
                    {issue.title}
                  </div>
                ))}
                {singleIssues.length > 10 && (
                  <div className="p-2 text-sm text-muted-foreground">
                    ...and {singleIssues.length - 10} more
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>

        {/* Selection Summary */}
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border">
          <div className="text-sm text-muted-foreground">
            {selectedCount} batch{selectedCount !== 1 ? 'es' : ''} selected ({totalIssuesInSelected} issues)
            {selectedSingleIssueNumbers.size > 0 && (
              <> + {selectedSingleIssueNumbers.size} single issue{selectedSingleIssueNumbers.size !== 1 ? 's' : ''}</>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderApproving = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-6">
      <Loader2 className="h-12 w-12 text-primary animate-spin" />
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Creating Batches...</h3>
        <p className="text-sm text-muted-foreground">
          Setting up the approved issue batches for processing.
        </p>
      </div>
    </div>
  );

  const renderDone = () => (
    <div className="flex flex-col items-center justify-center py-8 space-y-6">
      <div className="p-4 rounded-full bg-green-500/10">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
      </div>
      <div className="text-center space-y-2">
        <h3 className="text-lg font-semibold">Batches Created</h3>
        <p className="text-sm text-muted-foreground">
          Your selected issue batches are ready for processing.
        </p>
      </div>
      <Button onClick={onClose}>
        Close
      </Button>
    </div>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Analyze & Group Issues
          </DialogTitle>
          <DialogDescription>
            {step === 'intro' && 'Analyze open issues and group similar ones for batch processing.'}
            {step === 'analyzing' && 'Analyzing issues for semantic similarity...'}
            {step === 'review' && 'Review and approve the proposed issue batches.'}
            {step === 'approving' && 'Creating the approved batches...'}
            {step === 'done' && 'Batches have been created successfully.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === 'intro' && renderIntro()}
          {step === 'analyzing' && renderAnalyzing()}
          {step === 'review' && renderReview()}
          {step === 'approving' && renderApproving()}
          {step === 'done' && renderDone()}
        </div>

        {step === 'review' && (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleApprove}
              disabled={(selectedBatchIds.size === 0 && selectedSingleIssueNumbers.size === 0) || isApproving}
            >
              {isApproving ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 me-2" />
                  Approve & Create ({selectedBatchIds.size + selectedSingleIssueNumbers.size} {selectedBatchIds.size + selectedSingleIssueNumbers.size === 1 ? 'batch' : 'batches'})
                </>
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface BatchCardProps {
  batch: ProposedBatch;
  index: number;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}

function BatchCard({
  batch,
  index,
  isSelected,
  isExpanded,
  onToggleSelect,
  onToggleExpand,
}: BatchCardProps) {
  const confidenceColor = batch.confidence >= 0.8
    ? 'text-green-500'
    : batch.confidence >= 0.6
      ? 'text-yellow-500'
      : 'text-red-500';

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isSelected
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggleSelect}
        />

        <Collapsible className="flex-1" open={isExpanded} onOpenChange={onToggleExpand}>
          <div className="flex items-center justify-between">
            <CollapsibleTrigger className="flex items-center gap-2 hover:underline">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-medium text-sm">
                {batch.theme || `Batch ${index + 1}`}
              </span>
            </CollapsibleTrigger>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Users className="h-3 w-3 me-1" />
                {batch.issueCount} issues
              </Badge>
              <Badge
                variant={batch.validated ? 'default' : 'secondary'}
                className="text-xs"
              >
                {batch.validated ? (
                  <CheckCircle2 className="h-3 w-3 me-1" />
                ) : (
                  <AlertTriangle className="h-3 w-3 me-1" />
                )}
                <span className={confidenceColor}>
                  {Math.round(batch.confidence * 100)}%
                </span>
              </Badge>
            </div>
          </div>

          <CollapsibleContent className="mt-3 space-y-2">
            {/* Reasoning */}
            <p className="text-xs text-muted-foreground px-6">
              {batch.reasoning}
            </p>

            {/* Issues List */}
            <div className="space-y-1 px-6">
              {batch.issues.map((issue) => (
                <div
                  key={issue.issueNumber}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-muted-foreground">
                      #{issue.issueNumber}
                    </span>
                    <span className="truncate">{issue.title}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(issue.similarityToPrimary * 100)}% similar
                  </span>
                </div>
              ))}
            </div>

            {/* Themes */}
            {batch.commonThemes.length > 0 && (
              <div className="flex flex-wrap gap-1 px-6 pt-2">
                {batch.commonThemes.map((theme, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {theme}
                  </Badge>
                ))}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

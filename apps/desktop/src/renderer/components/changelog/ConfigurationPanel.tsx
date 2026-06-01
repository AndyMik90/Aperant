import { useTranslation } from 'react-i18next';
import { ArrowLeft, FileText, GitCommit, Sparkles, RefreshCw, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Progress } from '../ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import {
  CHANGELOG_FORMAT_LABELS,
  CHANGELOG_AUDIENCE_LABELS,
  CHANGELOG_EMOJI_LEVEL_LABELS
} from '../../../shared/constants';
import { type SummaryInfo } from './utils';
import type {
  ChangelogFormat,
  ChangelogAudience,
  ChangelogEmojiLevel,
  ChangelogSourceMode
} from '../../../shared/types';

interface ConfigurationPanelProps {
  sourceMode: ChangelogSourceMode;
  summaryInfo: SummaryInfo;
  existingChangelog: { lastVersion?: string } | null;
  version: string;
  versionReason: string | null;
  date: string;
  format: ChangelogFormat;
  audience: ChangelogAudience;
  emojiLevel: ChangelogEmojiLevel;
  customInstructions: string;
  generationProgress: { stage: string; progress: number; message?: string; error?: string } | null;
  isGenerating: boolean;
  error: string | null;
  showAdvanced: boolean;
  canGenerate: boolean;
  onBack: () => void;
  onVersionChange: (v: string) => void;
  onDateChange: (d: string) => void;
  onFormatChange: (f: ChangelogFormat) => void;
  onAudienceChange: (a: ChangelogAudience) => void;
  onEmojiLevelChange: (l: ChangelogEmojiLevel) => void;
  onCustomInstructionsChange: (i: string) => void;
  onShowAdvancedChange: (show: boolean) => void;
  onGenerate: () => void;
}

export function ConfigurationPanel({
  sourceMode,
  summaryInfo,
  existingChangelog,
  version,
  versionReason,
  date,
  format,
  audience,
  emojiLevel,
  customInstructions,
  generationProgress,
  isGenerating,
  error,
  showAdvanced,
  canGenerate,
  onBack,
  onVersionChange,
  onDateChange,
  onFormatChange,
  onAudienceChange,
  onEmojiLevelChange,
  onCustomInstructionsChange,
  onShowAdvancedChange,
  onGenerate
}: ConfigurationPanelProps) {
  const { t } = useTranslation('changelog');

  const versionBumpDescription = versionReason
    ? versionReason === 'breaking'
      ? t('config.versionBump.major')
      : versionReason === 'feature'
        ? t('config.versionBump.minor')
        : t('config.versionBump.patch')
    : null;

  const includingText =
    sourceMode === 'tasks'
      ? t(
          summaryInfo.count === 1 ? 'config.includingTasksSingular' : 'config.includingTasksPlural',
          { count: summaryInfo.count }
        )
      : t(
          summaryInfo.count === 1
            ? 'config.includingCommitsSingular'
            : 'config.includingCommitsPlural',
          { count: summaryInfo.count }
        );

  return (
    <div className="w-80 shrink-0 border-e border-border overflow-y-auto">
      <div className="p-6 space-y-6">
        {/* Back button and summary */}
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ms-2">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            {t('config.backToSelection')}
          </Button>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              {sourceMode === 'tasks' ? (
                <FileText className="h-4 w-4" />
              ) : (
                <GitCommit className="h-4 w-4" />
              )}
              {includingText}
            </div>
            <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
              {summaryInfo.details}
            </div>
          </div>
        </div>

        {/* Version & Date */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('config.releaseInfo')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="version">{t('config.version')}</Label>
              <Input
                id="version"
                value={version}
                onChange={(e) => onVersionChange(e.target.value)}
                placeholder={t('config.versionPlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">{t('config.date')}</Label>
              <Input
                id="date"
                type="date"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
              />
            </div>
            {(existingChangelog?.lastVersion || versionBumpDescription) && (
              <div className="text-xs text-muted-foreground space-y-1">
                {existingChangelog?.lastVersion && (
                  <p>{t('config.previous', { version: existingChangelog.lastVersion })}</p>
                )}
                {versionBumpDescription && (
                  <p className="text-primary/70">{versionBumpDescription}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Format & Audience */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{t('config.outputStyle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('config.format')}</Label>
              <Select
                value={format}
                onValueChange={(value) => onFormatChange(value as ChangelogFormat)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(CHANGELOG_FORMAT_LABELS).map((value) => (
                    <SelectItem key={value} value={value}>
                      <div>
                        <div>{t(`formats.${value}.label`)}</div>
                        <div className="text-xs text-muted-foreground">
                          {t(`formats.${value}.description`)}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('config.audience')}</Label>
              <Select
                value={audience}
                onValueChange={(value) => onAudienceChange(value as ChangelogAudience)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(CHANGELOG_AUDIENCE_LABELS).map((value) => (
                    <SelectItem key={value} value={value}>
                      <div>
                        <div>{t(`audiences.${value}.label`)}</div>
                        <div className="text-xs text-muted-foreground">
                          {t(`audiences.${value}.description`)}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('config.emojis')}</Label>
              <Select
                value={emojiLevel}
                onValueChange={(value) => onEmojiLevelChange(value as ChangelogEmojiLevel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(CHANGELOG_EMOJI_LEVEL_LABELS).map((value) => (
                    <SelectItem key={value} value={value}>
                      <div>
                        <div>{t(`emojiLevels.${value}.label`)}</div>
                        <div className="text-xs text-muted-foreground">
                          {t(`emojiLevels.${value}.description`)}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Advanced Options */}
        <Collapsible open={showAdvanced} onOpenChange={onShowAdvancedChange}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between">
              {t('config.advancedOptions')}
              {showAdvanced ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Card>
              <CardContent className="pt-4">
                <div className="space-y-2">
                  <Label htmlFor="instructions">{t('config.customInstructions')}</Label>
                  <Textarea
                    id="instructions"
                    value={customInstructions}
                    onChange={(e) => onCustomInstructionsChange(e.target.value)}
                    placeholder={t('config.customInstructionsPlaceholder')}
                    rows={3}
                  />
                  <p className="text-xs text-muted-foreground">
                    {t('config.customInstructionsHint')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>

        {/* Generate Button */}
        <Button
          className="w-full"
          onClick={onGenerate}
          disabled={!canGenerate}
          size="lg"
        >
          {isGenerating ? (
            <>
              <RefreshCw className="me-2 h-4 w-4 animate-spin" />
              {t('config.generating')}
            </>
          ) : (
            <>
              <Sparkles className="me-2 h-4 w-4" />
              {t('config.generateChangelog')}
            </>
          )}
        </Button>

        {/* Progress */}
        {generationProgress && isGenerating && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{t(`stages.${generationProgress.stage}`)}</span>
              <span>{generationProgress.progress}%</span>
            </div>
            <Progress value={generationProgress.progress} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <span className="text-destructive">{error}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

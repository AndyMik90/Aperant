import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitMerge, Copy, Check, Sparkles } from 'lucide-react';
import { Button } from '../../ui/button';
import { Textarea } from '../../ui/textarea';

interface StagedSuccessMessageProps {
  stagedSuccess: string;
  suggestedCommitMessage?: string;
}

/**
 * Displays success message after changes have been staged in the main project
 */
export function StagedSuccessMessage({
  stagedSuccess,
  suggestedCommitMessage
}: StagedSuccessMessageProps) {
  const { t } = useTranslation('taskReview');
  const [commitMessage, setCommitMessage] = useState(suggestedCommitMessage || '');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!commitMessage) return;
    try {
      await navigator.clipboard.writeText(commitMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="rounded-xl border border-success/30 bg-success/10 p-4">
      <h3 className="font-medium text-sm text-foreground mb-2 flex items-center gap-2">
        <GitMerge className="h-4 w-4 text-success" />
        {t('staged.title')}
      </h3>
      <p className="text-sm text-muted-foreground mb-3">
        {stagedSuccess}
      </p>

      {/* Commit Message Section */}
      {suggestedCommitMessage && (
        <div className="bg-background/50 rounded-lg p-3 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-purple-400" />
              {t('staged.aiGeneratedCommit')}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              className="h-6 px-2 text-xs"
              disabled={!commitMessage}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 mr-1 text-success" />
                  {t('staged.copied')}
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 mr-1" />
                  {t('staged.copy')}
                </>
              )}
            </Button>
          </div>
          <Textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            className="font-mono text-xs min-h-[100px] bg-background/80 resize-y"
            placeholder={t('staged.commitPlaceholder')}
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            {t('staged.editHint')} <code className="bg-background px-1 rounded">git commit -m "..."</code>
          </p>
        </div>
      )}

      <div className="bg-background/50 rounded-lg p-3">
        <p className="text-xs text-muted-foreground mb-2">{t('staged.nextSteps')}</p>
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
          <li>{t('staged.step1')}</li>
          <li>{t('staged.step2')} <code className="bg-background px-1 rounded">git status</code> and <code className="bg-background px-1 rounded">git diff --staged</code></li>
          <li>{t('staged.step3')} <code className="bg-background px-1 rounded">git commit -m "your message"</code></li>
        </ol>
      </div>
    </div>
  );
}

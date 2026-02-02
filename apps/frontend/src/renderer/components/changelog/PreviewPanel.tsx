import { useState, useMemo, useEffect } from 'react';
import { FileText, Copy, Save, CheckCircle, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface LocalImageProps {
  src: string;
  alt: string;
  projectPath?: string;
}

function LocalImage({ src, alt, projectPath }: LocalImageProps) {
  const { t } = useTranslation('changelog');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      setImageSrc(src);
      setLoading(false);
      return;
    }

    if (!projectPath) {
      setError(t('preview.loadImageError'));
      setLoading(false);
      return;
    }

    const loadImage = async () => {
      try {
        setLoading(true);
        setError(null);
        const relativePath = src.startsWith('./') ? src.slice(2) : src;
        const result = await window.electronAPI.readLocalImage(projectPath, relativePath);
        if (result.success && result.data) {
          setImageSrc(result.data);
        } else {
          setError(result.error || t('preview.loadImageFailed'));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('preview.loadImageFailed'));
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [src, projectPath, t]);

  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 rounded border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('preview.loadingImage')}</span>
      </span>
    );
  }

  if (error || !imageSrc) {
    return (
      <span className="inline-flex items-center gap-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <ImageIcon className="h-4 w-4" />
        <span>{error || t('preview.imageNotFound')}</span>
      </span>
    );
  }

  return <img src={imageSrc} alt={alt} className="max-w-full h-auto" />;
}

interface PreviewPanelProps {
  generatedChangelog: string;
  saveSuccess: boolean;
  copySuccess: boolean;
  canSave: boolean;
  isDragOver: boolean;
  imageError: string | null;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  projectPath?: string;
  onSave: () => void;
  onCopy: () => void;
  onChangelogEdit: (content: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

export function PreviewPanel({
  generatedChangelog,
  saveSuccess,
  copySuccess,
  canSave,
  isDragOver,
  imageError,
  textareaRef,
  projectPath,
  onSave,
  onCopy,
  onChangelogEdit,
  onPaste,
  onDragOver,
  onDragLeave,
  onDrop
}: PreviewPanelProps) {
  const { t } = useTranslation('changelog');
  const [viewMode, setViewMode] = useState<'markdown' | 'preview'>('markdown');

  const markdownComponents: Components = useMemo(() => ({
    img: ({ src, alt }) => {
      return <LocalImage src={src || ''} alt={alt || ''} projectPath={projectPath} />;
    }
  }), [projectPath]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Preview Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">{t('preview.preview')}</h2>
          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            <Button
              variant={viewMode === 'markdown' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('markdown')}
              className="h-7 px-3 text-xs"
            >
              {t('preview.markdown')}
            </Button>
            <Button
              variant={viewMode === 'preview' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setViewMode('preview')}
              className="h-7 px-3 text-xs"
            >
              {t('preview.preview')}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onCopy}
                disabled={!canSave}
              >
                {copySuccess ? (
                  <CheckCircle className="mr-2 h-4 w-4 text-success" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copySuccess ? t('preview.copied') : t('preview.copy')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('preview.copyToClipboard')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="sm"
                onClick={onSave}
                disabled={!canSave}
              >
                {saveSuccess ? (
                  <CheckCircle className="mr-2 h-4 w-4" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {saveSuccess ? t('preview.saved') : t('preview.saveToChangelog')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {t('preview.prependToChangelog')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Preview Content */}
      <div
        className={`flex-1 overflow-hidden p-6 ${isDragOver ? 'bg-muted/50' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {generatedChangelog ? (
          <>
            {isDragOver && (
              <div className="mb-4 rounded-lg border-2 border-dashed border-primary/50 bg-primary/5 p-4 text-center">
                <ImageIcon className="mx-auto h-8 w-8 text-primary/50" />
                <p className="mt-2 text-sm text-primary/70">{t('preview.dropImagesHere')}</p>
              </div>
            )}
            {imageError && (
              <div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {imageError}
              </div>
            )}
            {viewMode === 'markdown' ? (
              <div className="flex h-full flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5" />
                  <span>{t('preview.pasteImagesIntoDescription')}</span>
                </div>
                <Textarea
                  ref={textareaRef}
                  className="flex-1 w-full resize-none font-mono text-sm"
                  value={generatedChangelog}
                  onChange={(e) => onChangelogEdit(e.target.value)}
                  onPaste={onPaste}
                  placeholder={t('preview.placeholder')}
                />
              </div>
            ) : (
              <div className="h-full overflow-auto">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {generatedChangelog}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/30" />
              <p className="mt-4 text-sm text-muted-foreground">
                {t('preview.clickGenerateToCreate')}
              </p>
              <p className="mt-2 text-xs text-muted-foreground flex items-center justify-center gap-2">
                <ImageIcon className="h-3.5 w-3.5" />
                <span>{t('preview.pasteImagesIntoDescription')}</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

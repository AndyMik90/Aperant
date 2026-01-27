import { X, Folder, File, FileCode, FileJson, FileText, FileImage } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
import type { ReferencedFile } from '../../shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from './ui/tooltip';

interface ReferencedFilesSectionProps {
  files: ReferencedFile[];
  onRemove: (id: string) => void;
  maxFiles: number;
  disabled?: boolean;
  className?: string;
}

/**
 * Get appropriate icon based on file extension
 * Matches the pattern from FileTreeItem.tsx
 */
function getFileIcon(name: string, isDirectory: boolean): React.ReactNode {
  if (isDirectory) {
    return <Folder className="h-4 w-4 text-warning shrink-0" />;
  }

  const ext = name.split('.').pop()?.toLowerCase();

  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'py':
    case 'rb':
    case 'go':
    case 'rs':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'cs':
    case 'php':
    case 'swift':
    case 'kt':
      return <FileCode className="h-4 w-4 text-info shrink-0" />;
    case 'json':
    case 'yaml':
    case 'yml':
    case 'toml':
      return <FileJson className="h-4 w-4 text-warning shrink-0" />;
    case 'md':
    case 'txt':
    case 'rst':
      return <FileText className="h-4 w-4 text-muted-foreground shrink-0" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'webp':
    case 'ico':
      return <FileImage className="h-4 w-4 text-purple-400 shrink-0" />;
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return <FileCode className="h-4 w-4 text-pink-400 shrink-0" />;
    case 'html':
    case 'htm':
      return <FileCode className="h-4 w-4 text-orange-400 shrink-0" />;
    default:
      return <File className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

/**
 * Truncate a path for display, showing the beginning and end
 */
function truncatePath(path: string, maxLength: number = 40): string {
  if (path.length <= maxLength) return path;

  const start = Math.floor(maxLength / 3);
  const end = maxLength - start - 3; // 3 for "..."
  return `${path.slice(0, start)}...${path.slice(-end)}`;
}

/**
 * ReferencedFilesSection displays a list of referenced files with remove functionality
 * Styled similarly to the ImageUpload section
 */
export function ReferencedFilesSection({
  files,
  onRemove,
  maxFiles,
  disabled = false,
  className
}: ReferencedFilesSectionProps) {
  const { t } = useTranslation('common');

  if (files.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className={cn('space-y-2', className)}>
        {/* Header with count badge */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {t('fileExplorer.referencedFiles')}
            <span className="ml-2 text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded">
              {files.length}/{maxFiles}
            </span>
          </span>
        </div>

        {/* File list */}
        <div className="space-y-1">
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                'group flex items-center gap-2 py-1.5 px-2 rounded-md',
                'bg-muted/50 hover:bg-muted transition-colors',
                'border border-border'
              )}
            >
              {/* File/folder icon */}
              {getFileIcon(file.name, file.isDirectory)}

              {/* File name and path */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">
                    {file.name}
                  </span>
                  {file.isDirectory && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded">
                      {t('fileExplorer.folder')}
                    </span>
                  )}
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <p className="text-xs text-muted-foreground truncate cursor-default">
                      {truncatePath(file.path)}
                    </p>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="max-w-md">
                    <p className="text-xs break-all">{file.path}</p>
                  </TooltipContent>
                </Tooltip>
              </div>

              {/* Remove button */}
              {!disabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity',
                    'hover:bg-destructive/10 hover:text-destructive'
                  )}
                  onClick={() => onRemove(file.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

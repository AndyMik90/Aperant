import { X, FolderTree, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { FileTree } from './FileTree';
import { useFileExplorerStore } from '../stores/file-explorer-store';
import { cn } from '../lib/utils';

interface TaskFileExplorerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projectPath: string;
}

export function TaskFileExplorerDrawer({ isOpen, onClose, projectPath }: TaskFileExplorerDrawerProps) {
  const { clearCache, loadDirectory } = useFileExplorerStore();

  const handleRefresh = () => {
    clearCache();
    loadDirectory(projectPath);
  };

  return (
    <div
      className={cn(
        'h-full bg-card border-l border-border flex flex-col shadow-xl overflow-hidden',
        'transition-[width,opacity] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
        isOpen ? 'w-72 opacity-100' : 'w-0 opacity-0'
      )}
      style={{ minWidth: 0 }}
    >
      <div
        className={cn(
          'flex flex-col h-full w-72',
          'transition-[transform,opacity] duration-250 delay-100 ease-[cubic-bezier(0.4,0,0.2,1)]',
          isOpen ? 'translate-x-0 opacity-100' : 'translate-x-5 opacity-0'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80 shrink-0">
          <div className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium whitespace-nowrap">Project Files</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleRefresh}
              title="Refresh"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
              title="Close"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Drag hint */}
        <div className="px-3 py-2 bg-muted/30 border-b border-border shrink-0">
          <p className="text-[10px] text-muted-foreground whitespace-nowrap">
            Drag files to add as references
          </p>
        </div>

        {/* File tree - no ScrollArea wrapper as FileTree uses virtualization with its own scroll container */}
        <div className="flex-1 min-h-0">
          <FileTree rootPath={projectPath} />
        </div>
      </div>
    </div>
  );
}

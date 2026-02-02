import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FileTreeItem } from './FileTreeItem';
import { useFileExplorerStore } from '../stores/file-explorer-store';
import { useVirtualizedTree } from '../hooks/useVirtualizedTree';
import { Loader2, AlertCircle, FolderOpen } from 'lucide-react';

interface FileTreeProps {
  rootPath: string;
}

// Estimated height of each tree item in pixels
const ITEM_HEIGHT = 28;
// Number of items to render outside the visible area for smoother scrolling
const OVERSCAN = 10;

export function FileTree({ rootPath }: FileTreeProps) {
  const { t } = useTranslation(['common']);
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    loadDirectory,
    isLoadingDir,
    error
  } = useFileExplorerStore();

  const {
    flattenedNodes,
    count,
    handleToggle,
    isRootLoading,
    hasRootFiles
  } = useVirtualizedTree(rootPath);

  const loading = isLoadingDir(rootPath);

  // Load root directory on mount
  useEffect(() => {
    if (!hasRootFiles && !loading) {
      loadDirectory(rootPath);
    }
  }, [rootPath, hasRootFiles, loading, loadDirectory]);

  // Set up the virtualizer
  const rowVirtualizer = useVirtualizer({
    count,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: OVERSCAN,
  });

  // Create toggle handler for each item
  const createToggleHandler = useCallback(
    (index: number) => {
      return () => {
        const item = flattenedNodes[index];
        if (item) {
          handleToggle(item.node);
        }
      };
    },
    [flattenedNodes, handleToggle]
  );

  if (isRootLoading && !hasRootFiles) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <AlertCircle className="h-5 w-5 text-destructive mb-2" />
        <p className="text-xs text-destructive">{error}</p>
      </div>
    );
  }

  if (!hasRootFiles || count === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
        <FolderOpen className="h-6 w-6 text-muted-foreground mb-2" />
        <p className="text-xs text-muted-foreground">{t('common:labels.noFilesFound')}</p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto py-1"
    >
      {/* The large inner element to hold all of the items */}
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {/* Only the visible items in the virtualizer */}
        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
          const item = flattenedNodes[virtualItem.index];
          if (!item) return null;

          return (
            <div
              key={item.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <FileTreeItem
                node={item.node}
                depth={item.depth}
                isExpanded={item.isExpanded}
                isLoading={item.isLoading}
                onToggle={createToggleHandler(virtualItem.index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

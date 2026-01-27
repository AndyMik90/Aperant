import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { X, FolderTree, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { FileTree } from './FileTree';
import { useFileExplorerStore } from '../stores/file-explorer-store';

interface FileExplorerPanelProps {
  projectPath: string;
}

// Animation variants for the sidebar panel
const panelVariants = {
  hidden: {
    width: 0,
    opacity: 0
  },
  visible: {
    width: 288, // w-72 = 18rem = 288px
    opacity: 1
  }
};

// Animation for the content inside (slides in slightly delayed)
const contentVariants = {
  hidden: {
    x: 20,
    opacity: 0
  },
  visible: {
    x: 0,
    opacity: 1
  }
};

export function FileExplorerPanel({ projectPath }: FileExplorerPanelProps) {
  const { t } = useTranslation('common');
  const { isOpen, close, clearCache, loadDirectory } = useFileExplorerStore();

  const handleRefresh = () => {
    clearCache();
    loadDirectory(projectPath);
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          variants={panelVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          transition={{
            width: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
            opacity: { duration: 0.2 }
          }}
          className="h-full bg-card border-l border-border flex flex-col shadow-xl overflow-hidden"
          style={{ minWidth: 0 }}
        >
          <motion.div
            variants={contentVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{
              duration: 0.25,
              delay: 0.1,
              ease: [0.4, 0, 0.2, 1]
            }}
            className="flex flex-col h-full w-72"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80 shrink-0">
              <div className="flex items-center gap-2">
                <FolderTree className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium whitespace-nowrap">{t('fileExplorer.title')}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={handleRefresh}
                  aria-label={t('buttons.refresh')}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={close}
                  aria-label={t('buttons.close')}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Drag hint */}
            <div className="px-3 py-2 bg-muted/30 border-b border-border shrink-0">
              <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                {t('fileExplorer.dragHint')}
              </p>
            </div>

            {/* File tree */}
            <ScrollArea className="flex-1">
              <FileTree rootPath={projectPath} />
            </ScrollArea>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

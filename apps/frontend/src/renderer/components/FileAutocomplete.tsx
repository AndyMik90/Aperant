import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { File, Folder, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useFileExplorerStore } from '../stores/file-explorer-store';
import type { FileNode } from '../../shared/types';

interface FileAutocompleteProps {
  query: string;
  projectPath: string;
  position: { top: number; left: number };
  onSelect: (filename: string, fullPath: string) => void;
  onClose: () => void;
  maxResults?: number;
}

/**
 * Autocomplete popup for @ file mentions in the task description.
 * Shows filtered list of files based on the query after @.
 */
export function FileAutocomplete({
  query,
  projectPath,
  position,
  onSelect,
  onClose,
  maxResults = 10
}: FileAutocompleteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const { files, loadDirectory } = useFileExplorerStore();

  // Load root directory if not cached
  useEffect(() => {
    if (projectPath && !files.has(projectPath)) {
      loadDirectory(projectPath);
    }
  }, [projectPath, files, loadDirectory]);

  // Collect all files from cache (flatten the tree)
  const allFiles = useMemo(() => {
    const result: FileNode[] = [];

    // Recursive function to collect all cached files
    const collectFiles = (dirPath: string, visited = new Set<string>()) => {
      if (visited.has(dirPath)) return;
      visited.add(dirPath);

      const dirFiles = files.get(dirPath);
      if (!dirFiles) return;

      for (const file of dirFiles) {
        result.push(file);
        // For directories, also load and collect their children if cached
        if (file.isDirectory && files.has(file.path)) {
          collectFiles(file.path, visited);
        }
      }
    };

    collectFiles(projectPath);
    return result;
  }, [files, projectPath]);

  // Filter files based on query
  const filteredFiles = useMemo(() => {
    if (!query) {
      // Show most recently accessed or common files when no query
      return allFiles.filter(f => !f.isDirectory).slice(0, maxResults);
    }

    const lowerQuery = query.toLowerCase();

    // Score files by match quality
    const scored = allFiles
      .filter(f => !f.isDirectory) // Only files, not directories
      .map(file => {
        const name = file.name.toLowerCase();
        const path = file.path.toLowerCase();

        let score = 0;

        // Exact name match (highest priority)
        if (name === lowerQuery) {
          score = 1000;
        }
        // Name starts with query
        else if (name.startsWith(lowerQuery)) {
          score = 100;
        }
        // Name contains query
        else if (name.includes(lowerQuery)) {
          score = 50;
        }
        // Path contains query
        else if (path.includes(lowerQuery)) {
          score = 10;
        }

        return { file, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map(item => item.file);

    return scored;
  }, [allFiles, query, maxResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const selectedElement = list.children[selectedIndex] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev =>
          prev < filteredFiles.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredFiles[selectedIndex]) {
          const file = filteredFiles[selectedIndex];
          onSelect(file.name, file.path);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        e.preventDefault();
        if (filteredFiles[selectedIndex]) {
          const file = filteredFiles[selectedIndex];
          onSelect(file.name, file.path);
        }
        break;
    }
  }, [filteredFiles, selectedIndex, onSelect, onClose]);

  // Attach keyboard listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Get relative path from project root
  const getRelativePath = (fullPath: string) => {
    if (fullPath.startsWith(projectPath)) {
      return fullPath.slice(projectPath.length + 1); // +1 for the slash
    }
    return fullPath;
  };

  // Don't render if no results
  if (filteredFiles.length === 0) {
    return (
      <div
        className="absolute z-50 bg-popover border border-border rounded-md shadow-lg p-3 text-sm text-muted-foreground"
        style={{
          top: position.top,
          left: position.left,
          minWidth: '200px'
        }}
      >
        No files found
      </div>
    );
  }

  return (
    <div
      className="absolute z-50 bg-popover border border-border rounded-md shadow-lg overflow-hidden"
      style={{
        top: position.top,
        left: position.left,
        minWidth: '280px',
        maxWidth: '400px',
        maxHeight: '240px'
      }}
    >
      <div
        ref={listRef}
        className="overflow-y-auto max-h-[240px]"
      >
        {filteredFiles.map((file, index) => (
          <button
            key={file.path}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 text-left text-sm',
              'hover:bg-accent hover:text-accent-foreground',
              'focus:outline-none transition-colors',
              index === selectedIndex && 'bg-accent text-accent-foreground'
            )}
            onClick={() => onSelect(file.name, file.path)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            {file.isDirectory ? (
              <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <File className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{file.name}</div>
              <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                <ChevronRight className="h-3 w-3 shrink-0" />
                {getRelativePath(file.path)}
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground bg-muted/30">
        <span className="font-medium">↑↓</span> navigate · <span className="font-medium">Enter</span> select · <span className="font-medium">Esc</span> close
      </div>
    </div>
  );
}

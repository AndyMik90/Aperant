import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../../lib/utils';

interface ResizeHandleProps {
  onResize: (delta: number) => void;
  className?: string;
}

/**
 * A vertical resize handle for dragging between panels
 */
export function ResizeHandle({ onResize, className }: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  // Track active listeners for cleanup on unmount during drag
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      onResize(delta);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      cleanupRef.current = null;
      // Re-enable text selection
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    // Prevent text selection during drag
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Store cleanup function for unmount during active drag
    cleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onResize]);

  // Cleanup on unmount — remove listeners if unmounted during active drag
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  return (
    <div
      className={cn(
        'w-1 hover:w-1 cursor-col-resize flex-shrink-0 transition-colors',
        'hover:bg-primary/20',
        isDragging && 'bg-primary/30',
        className
      )}
      onMouseDown={handleMouseDown}
      style={{
        width: '4px',
        minWidth: '4px',
        cursor: 'col-resize'
      }}
    />
  );
}

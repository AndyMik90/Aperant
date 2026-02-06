/**
 * ResizablePanels - A split panel layout with a draggable divider
 *
 * Features:
 * - Smooth drag-to-resize functionality
 * - Min/max width constraints
 * - Persists width to localStorage
 * - Visual feedback on hover and drag
 * - Touch support for mobile devices
 */

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface ResizablePanelsProps {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
  defaultLeftWidth?: number;  // percentage, default 50
  minLeftWidth?: number;      // percentage, default 30
  maxLeftWidth?: number;      // percentage, default 70
  storageKey?: string;        // localStorage key for persistence
  className?: string;
}

export function ResizablePanels({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 50,
  minLeftWidth = 30,
  maxLeftWidth = 70,
  storageKey,
  className,
}: ResizablePanelsProps) {
  // Load initial width from storage or use default
  const [leftWidth, setLeftWidth] = useState(() => {
    if (storageKey) {
      try {
        const stored = localStorage.getItem(storageKey);
        if (stored) {
          const parsed = parseFloat(stored);
          if (!Number.isNaN(parsed) && parsed >= minLeftWidth && parsed <= maxLeftWidth) {
            return parsed;
          }
        }
      } catch {
        // localStorage may be unavailable (e.g., private browsing)
      }
    }
    return defaultLeftWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save to storage when width changes (debounced by only saving when not dragging)
  useEffect(() => {
    if (storageKey && !isDragging) {
      try {
        localStorage.setItem(storageKey, leftWidth.toString());
      } catch {
        // localStorage may be unavailable (e.g., private browsing, quota exceeded)
      }
    }
  }, [leftWidth, storageKey, isDragging]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      // Guard against division by zero when container has no width
      if (rect.width <= 0) return;
      const newWidth = ((e.clientX - rect.left) / rect.width) * 100;
      const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newWidth));
      setLeftWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!containerRef.current || e.touches.length === 0) return;

      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const touch = e.touches[0];
      const newWidth = ((touch.clientX - rect.left) / rect.width) * 100;
      const clampedWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, newWidth));
      setLeftWidth(clampedWidth);
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
    };

    // Add user-select: none to body during drag to prevent text selection
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, minLeftWidth, maxLeftWidth]);

  return (
    <div
      ref={containerRef}
      className={cn("flex-1 flex min-h-0", className)}
    >
      {/* Left panel */}
      <div
        className="flex flex-col min-w-0 overflow-hidden"
        style={{ width: `${leftWidth}%` }}
      >
        {leftPanel}
      </div>

      {/* Resizable divider */}
      <div
        className={cn(
          "w-1 flex-shrink-0 relative cursor-col-resize touch-none",
          "bg-border transition-colors duration-150",
          "hover:bg-primary/40",
          isDragging && "bg-primary/60"
        )}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        {/* Wider invisible hit area for easier grabbing */}
        <div className="absolute inset-y-0 -left-1 -right-1 z-10" />
      </div>

      {/* Right panel */}
      <div
        className="flex flex-col min-w-0 overflow-hidden"
        style={{ width: `${100 - leftWidth}%` }}
      >
        {rightPanel}
      </div>
    </div>
  );
}

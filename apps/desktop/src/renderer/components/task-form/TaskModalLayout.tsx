/**
 * TaskModalLayout - Shared layout component for large task modals
 *
 * Provides consistent styling matching TaskDetailModal exactly:
 * - Full-height modal (95vw width, near full height)
 * - Positioned 16px from top (same as TaskDetailModal)
 * - Header with title, description, and close button
 * - Scrollable body content
 * - Footer with action buttons
 */
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/utils';
import type { ReactNode } from 'react';

interface TaskModalLayoutProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Modal title */
  title: string;
  /** Modal description */
  description?: string;
  /** Main content of the modal */
  children: ReactNode;
  /** Footer content (action buttons) */
  footer: ReactNode;
  /** Optional sidebar content (e.g., file explorer) */
  sidebar?: ReactNode;
  /** Whether sidebar is visible */
  sidebarOpen?: boolean;
  /** Whether the modal is in a loading/disabled state */
  disabled?: boolean;
}

export function TaskModalLayout({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  sidebar,
  sidebarOpen = false,
  disabled = false
}: TaskModalLayoutProps) {
  const { t } = useTranslation('common');

  const handleClose = () => {
    if (!disabled) {
      onOpenChange(false);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleClose}>
      <DialogPrimitive.Portal>
        {/* Semi-transparent overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />

        {/* Full-height modal content - matches TaskDetailModal exactly */}
        <DialogPrimitive.Content
          className={cn(
            'fixed start-[50%] top-4 z-50',
            'translate-x-[-50%]',
            'w-[95vw] max-w-5xl h-[calc(100vh-32px)]',
            'bg-card border border-border rounded-xl',
            'shadow-2xl overflow-hidden flex flex-col',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200'
          )}
        >
          <div className="flex h-full min-h-0 overflow-hidden">
            {/* Main content area */}
            <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
              {/* Header */}
              <div className="px-6 py-5 border-b border-border shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <DialogPrimitive.Title className="text-xl font-semibold leading-tight text-foreground">
                      {title}
                    </DialogPrimitive.Title>
                    {description && (
                      <DialogPrimitive.Description className="mt-1.5 text-sm text-muted-foreground">
                        {description}
                      </DialogPrimitive.Description>
                    )}
                  </div>
                  <DialogPrimitive.Close asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-muted transition-colors shrink-0"
                      disabled={disabled}
                    >
                      <X className="h-5 w-5" />
                      <span className="sr-only">{t('buttons.close')}</span>
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              {/* Scrollable body */}
              <ScrollArea className="flex-1 min-h-0">
                <div className="p-6">
                  {children}
                </div>
              </ScrollArea>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-border shrink-0 bg-muted/30">
                {footer}
              </div>
            </div>

            {/* Optional sidebar */}
            {sidebar && sidebarOpen && (
              <div className="w-80 border-s border-border flex-shrink-0 overflow-hidden">
                {sidebar}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

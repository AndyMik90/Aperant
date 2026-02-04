import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { KEYBOARD_SHORTCUTS } from '../hooks/useKeyboardNavigation';

interface KeyboardShortcutsHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * UX-5: Keyboard shortcuts help modal.
 * Shows available keyboard shortcuts for navigation.
 */
export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  const { t } = useTranslation(['common']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('keyboardShortcuts.title', { defaultValue: 'Keyboard Shortcuts' })}</DialogTitle>
          <DialogDescription>
            {t('keyboardShortcuts.description', { defaultValue: 'Navigate quickly with these shortcuts' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Group shortcuts by context */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Navigation</h4>
            <div className="space-y-2">
              {KEYBOARD_SHORTCUTS
                .filter(s => s.context === 'Kanban board' || s.context === 'Anywhere')
                .map((shortcut, i) => (
                  <ShortcutRow key={i} shortcut={shortcut} />
                ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Task Actions</h4>
            <div className="space-y-2">
              {KEYBOARD_SHORTCUTS
                .filter(s => s.context === 'Task selected')
                .map((shortcut, i) => (
                  <ShortcutRow key={i} shortcut={shortcut} />
                ))}
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs bg-muted rounded">?</kbd> anytime to show this help
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShortcutRow({ shortcut }: { shortcut: typeof KEYBOARD_SHORTCUTS[number] }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-foreground">{shortcut.action}</span>
      <kbd className="px-2 py-1 text-xs bg-muted text-muted-foreground rounded font-mono">
        {shortcut.key}
      </kbd>
    </div>
  );
}

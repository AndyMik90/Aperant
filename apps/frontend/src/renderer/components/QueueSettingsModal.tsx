import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from './ui/dialog';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Input } from './ui/input';

/**
 * Props for QueueSettingsModal component
 */
interface QueueSettingsModalProps {
  /** Whether the modal is currently open */
  open: boolean;
  /** Callback to control modal open state */
  onOpenChange: (open: boolean) => void;
  /** The project ID to update settings for */
  projectId: string;
  /** Current maximum parallel tasks setting (default: 3) */
  currentMaxParallel?: number;
  /** Callback when user saves the new max parallel value */
  onSave: (maxParallel: number) => void;
}

/**
 * QueueSettingsModal - Modal for configuring queue parallel task limits
 *
 * Allows users to adjust the maximum number of tasks that can run in parallel
 * for a specific project. Validates input between 1-10 tasks.
 */
export function QueueSettingsModal({
  open,
  onOpenChange,
  projectId,
  currentMaxParallel = 3,
  onSave
}: QueueSettingsModalProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [maxParallel, setMaxParallel] = useState(currentMaxParallel);
  const [error, setError] = useState<string | null>(null);

  // Reset to current value when modal opens
  useEffect(() => {
    if (open) {
      setMaxParallel(currentMaxParallel);
      setError(null);
    }
  }, [open, currentMaxParallel]);

  /**
   * Validates and saves the max parallel tasks setting
   *
   * Validates that the value is between 1-10, sets an error message
   * if invalid, otherwise calls onSave and closes the modal.
   */
  const handleSave = () => {
    // Validate the input
    if (maxParallel < 1) {
      setError(t('tasks:queue.settings.minValueError'));
      return;
    }
    if (maxParallel > 10) {
      setError(t('tasks:queue.settings.maxValueError'));
      return;
    }

    onSave(maxParallel);
    onOpenChange(false);
  };

  /**
   * Handles input field changes for the max parallel tasks value
   *
   * Parses the input value, validates it's a number, and updates state.
   * Allows empty input for editing purposes (will fail validation on save).
   *
   * @param e - The input change event from the number input field
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;

    // Handle empty input - allow clearing the field
    if (inputValue === '') {
      setMaxParallel(0); // Reset to 0 (will fail validation, but allows re-entry)
      setError(null);
      return;
    }

    const value = parseInt(inputValue, 10);
    if (!Number.isNaN(value)) {
      setMaxParallel(value);
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('tasks:queue.settings.title')}</DialogTitle>
          <DialogDescription>
            {t('tasks:queue.settings.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="maxParallel">
              {t('tasks:queue.settings.maxParallelLabel')}
            </Label>
            <Input
              id="maxParallel"
              type="number"
              min={1}
              max={10}
              value={maxParallel}
              onChange={handleInputChange}
              className="w-full"
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            <p className="text-sm text-muted-foreground">
              {t('tasks:queue.settings.hint')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common:buttons.cancel')}
          </Button>
          <Button onClick={handleSave}>
            {t('common:buttons.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

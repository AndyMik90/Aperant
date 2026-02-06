import { useRef, useEffect, KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  value,
  onChange,
  onSend,
  onCancel,
  isLoading = false,
  disabled = false,
  placeholder = 'Ask about your codebase...'
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!value.trim()) return;
    if (disabled) return;

    onSend(value);
  };

  const handleCancel = () => {
    onCancel?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends (Shift+Enter for newline)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }

    // Escape cancels generation
    if (e.key === 'Escape' && isLoading && onCancel) {
      e.preventDefault();
      handleCancel();
    }
  };

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="border border-border rounded-lg bg-background overflow-hidden">
      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-[80px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-end px-3 py-2 border-t border-border">
        {/* Send/Stop button (right) */}
        {isLoading && onCancel ? (
          <Button
            variant="destructive"
            size="sm"
            className="h-8 w-8 p-0 rounded-full"
            onClick={handleCancel}
            title="Stop generation (Esc)"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 w-8 p-0 rounded-full"
            onClick={handleSend}
            disabled={!canSend}
            title="Send message (Enter)"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

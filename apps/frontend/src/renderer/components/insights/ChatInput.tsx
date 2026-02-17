import { useRef, useEffect, useState, KeyboardEvent, ClipboardEvent, DragEvent } from 'react';
import { ArrowUp, Square, X, ImagePlus } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/utils';
import type { PastedImage } from '../chat';

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (message: string, images?: PastedImage[]) => void;
  onCancel?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

let pasteCounter = 0;

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
  const [pendingImages, setPendingImages] = useState<PastedImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const id = `paste-${Date.now()}-${++pasteCounter}`;
          const filename = `paste-${Date.now()}.png`;
          setPendingImages((prev) => [...prev, { id, dataUrl, filename }]);
        };
        reader.readAsDataURL(blob);
        break; // Only handle the first image
      }
    }
  };

  const handleDragEnter = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const id = `drop-${Date.now()}-${++pasteCounter}`;
        setPendingImages((prev) => [...prev, { id, dataUrl, filename: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = (id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleSend = () => {
    if (!value.trim() && pendingImages.length === 0) return;
    if (disabled) return;

    // If currently loading, cancel the existing generation first
    if (isLoading && onCancel) {
      onCancel();
    }

    onSend(value, pendingImages.length > 0 ? pendingImages : undefined);
    setPendingImages([]);
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

  const canSend = value.trim().length > 0 || pendingImages.length > 0;

  return (
    <div
      className={cn(
        "border rounded-lg bg-background overflow-hidden relative",
        isDragging ? "border-primary border-dashed" : "border-border"
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 bg-primary/10 flex items-center justify-center pointer-events-none rounded-lg">
          <div className="flex items-center gap-2 text-primary text-sm font-medium">
            <ImagePlus className="h-5 w-5" />
            Drop image here
          </div>
        </div>
      )}

      {/* Pasted image previews */}
      {pendingImages.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {pendingImages.map((img) => (
            <div key={img.id} className="relative group">
              <img
                src={img.dataUrl}
                alt={img.filename}
                className="h-20 max-w-32 rounded-md border border-border object-cover"
              />
              <button
                onClick={() => removeImage(img.id)}
                className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        placeholder={placeholder}
        className="min-h-[80px] resize-none border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      {/* Bottom toolbar */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-border">
        {/* Stop button (when loading) */}
        {isLoading && onCancel && (
          <Button
            variant="destructive"
            size="sm"
            className="h-8 w-8 p-0 rounded-full"
            onClick={handleCancel}
            title="Stop generation (Esc)"
          >
            <Square className="h-4 w-4" />
          </Button>
        )}
        {/* Send button (always available) */}
        <Button
          size="sm"
          className="h-8 w-8 p-0 rounded-full"
          onClick={handleSend}
          disabled={!canSend}
          title="Send message (Enter)"
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

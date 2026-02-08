/**
 * Shared UserMessage - Right-aligned chat bubble for user messages.
 *
 * Optionally shows pasted image thumbnails.
 */

export interface PastedImage {
  id: string;
  dataUrl: string;
  filename: string;
}

interface UserMessageProps {
  content: string;
  images?: PastedImage[];
}

export function UserMessage({ content, images }: UserMessageProps) {
  return (
    <div className="flex justify-end py-2">
      <div className="max-w-[80%]">
        {/* Image thumbnails */}
        {images && images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 justify-end">
            {images.map((img) => (
              <img
                key={img.id}
                src={img.dataUrl}
                alt={img.filename}
                className="max-h-32 max-w-48 rounded-lg border border-border object-cover"
              />
            ))}
          </div>
        )}
        <div className="bg-primary text-primary-foreground px-4 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

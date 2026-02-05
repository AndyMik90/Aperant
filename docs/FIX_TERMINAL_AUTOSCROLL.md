# Fix: Terminal & Chat Auto-Scroll

**Created:** 2026-02-04
**Priority:** Medium
**Status:** Pending

---

## Problems

### 1. Terminal Panel Auto-Scroll
The terminal panel (bottom of Kanban view) doesn't auto-scroll to the bottom when new content arrives. Users have to manually scroll down to see the latest output.

### 2. Chat View Scroll Position
When switching back to the Chat view, it starts at the TOP and then visibly scrolls down to the bottom. It should just always BE at the bottom - no visible scroll animation on view switch.

---

## Expected Behavior

### Terminal
- Terminal should automatically scroll to bottom when new tool calls/outputs appear
- Should only auto-scroll if user is already at/near the bottom
- If user has scrolled up to read history, don't interrupt them

### Chat
- Chat should ALWAYS render with scroll at bottom (latest messages visible)
- When switching views and coming back to Chat, should instantly be at bottom
- No visible "scroll from top to bottom" animation on mount
- New messages should auto-scroll to bottom

---

## Files to Check

### Terminal
1. `src/renderer/components/terminal/StructuredOutput.tsx` - Timeline view
2. `src/renderer/components/terminal/RawTerminal.tsx` - Raw view
3. `src/renderer/components/TaskCard.tsx` - Inline terminal expansion
4. Any ScrollArea components wrapping terminal content

### Chat
1. `src/renderer/components/Insights.tsx` - Main chat component
2. Look for ScrollArea wrapping message list
3. Check how messages are rendered on mount

---

## Common Fix Pattern

```tsx
// Use a ref to track the scroll container
const scrollRef = useRef<HTMLDivElement>(null);

// Auto-scroll when content changes
useEffect(() => {
  if (scrollRef.current) {
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }
}, [messages]); // or whatever state holds the terminal content
```

Or with ScrollArea component:
```tsx
const scrollAreaRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}, [content]);
```

### For Chat (instant scroll on mount - no animation)
```tsx
// Use useLayoutEffect to scroll BEFORE paint (no visible scroll)
useLayoutEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}, []); // Empty deps = run once on mount

// Also scroll on new messages
useEffect(() => {
  const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (viewport) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}, [messages]);
```

Key difference: `useLayoutEffect` runs synchronously BEFORE the browser paints, so the scroll happens instantly without the user seeing the scroll animation.

---

## Notes

- Check if there's already auto-scroll logic that's broken
- May need to add "scroll to bottom" button as fallback
- Consider user preference setting for auto-scroll behavior

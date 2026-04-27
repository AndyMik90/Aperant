import * as React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  group?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

interface ComboboxProps {
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  allowCustomValue?: boolean;
  customValueLabel?: string;
  isLoading?: boolean;
}

type VirtualRow =
  | { kind: 'header'; label: string }
  | { kind: 'option'; option: ComboboxOption; optionIndex: number }
  | { kind: 'custom'; value: string };

const ROW_HEIGHT = 36;
const HEADER_HEIGHT = 28;
const LIST_HEIGHT = 300;

const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>(
  (
    {
      value,
      onValueChange,
      options,
      placeholder = 'Select...',
      searchPlaceholder = 'Search...',
      emptyMessage = 'No results found',
      loadingMessage = 'Loading…',
      disabled = false,
      className,
      id,
      allowCustomValue = false,
      customValueLabel = 'Use',
      isLoading = false,
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const [search, setSearch] = React.useState('');
    const [focusedIndex, setFocusedIndex] = React.useState(-1);
    // Callback ref so the virtualizer re-measures when the Portal mounts the element
    const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);
    const listboxId = React.useId();

    const selectedOption = options.find((opt) => opt.value === value);
    const displayValue = selectedOption?.label || (value || placeholder);

    const trimmedSearch = search.trim();

    const filteredOptions = React.useMemo(() => {
      if (!trimmedSearch) return options;
      const q = trimmedSearch.toLowerCase();
      return options.filter(
        (opt) =>
          opt.label.toLowerCase().includes(q) ||
          opt.value.toLowerCase().includes(q) ||
          opt.description?.toLowerCase().includes(q)
      );
    }, [options, trimmedSearch]);

    const showCustomOption =
      allowCustomValue &&
      trimmedSearch.length > 0 &&
      !options.some((opt) => opt.value === trimmedSearch);

    const virtualRows = React.useMemo<VirtualRow[]>(() => {
      const rows: VirtualRow[] = [];
      let lastGroup: string | undefined;
      for (let i = 0; i < filteredOptions.length; i++) {
        const opt = filteredOptions[i];
        if (opt.group && opt.group !== lastGroup) {
          rows.push({ kind: 'header', label: opt.group });
          lastGroup = opt.group;
        }
        rows.push({ kind: 'option', option: opt, optionIndex: i });
      }
      if (showCustomOption) rows.push({ kind: 'custom', value: trimmedSearch });
      return rows;
    }, [filteredOptions, showCustomOption, trimmedSearch]);

    const optionToVirtualIndex = React.useMemo(() => {
      const map = new Map<number, number>();
      virtualRows.forEach((row, vIdx) => {
        if (row.kind === 'option') map.set(row.optionIndex, vIdx);
        else if (row.kind === 'custom') map.set(filteredOptions.length, vIdx);
      });
      return map;
    }, [virtualRows, filteredOptions.length]);

    const totalNavigable = filteredOptions.length + (showCustomOption ? 1 : 0);
    const hasItems = virtualRows.length > 0;

    const virtualizer = useVirtualizer({
      count: virtualRows.length,
      getScrollElement: () => scrollEl,
      estimateSize: (i) => (virtualRows[i]?.kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
      overscan: 5,
    });

    // Track whether the last focusedIndex change came from keyboard (not mouse hover)
    const fromKeyboard = React.useRef(false);

    React.useEffect(() => {
      if (open) {
        const t = setTimeout(() => inputRef.current?.focus(), 0);
        setFocusedIndex(-1);
        return () => clearTimeout(t);
      }
      setSearch('');
      setFocusedIndex(-1);
    }, [open]);

    // Only auto-scroll on keyboard navigation — not on mouse hover
    React.useEffect(() => {
      if (!fromKeyboard.current || focusedIndex < 0) return;
      const vIdx = optionToVirtualIndex.get(focusedIndex);
      if (vIdx !== undefined) virtualizer.scrollToIndex(vIdx, { behavior: 'auto' });
      fromKeyboard.current = false;
    }, [focusedIndex, optionToVirtualIndex, virtualizer]);

    const handleSelect = (val: string) => {
      onValueChange(val);
      setOpen(false);
      setSearch('');
      setFocusedIndex(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!open) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          fromKeyboard.current = true;
          setFocusedIndex((prev) => (prev < totalNavigable - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          fromKeyboard.current = true;
          setFocusedIndex((prev) => (prev > 0 ? prev - 1 : totalNavigable - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
            handleSelect(filteredOptions[focusedIndex].value);
          } else if (showCustomOption && focusedIndex === filteredOptions.length) {
            handleSelect(trimmedSearch);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setOpen(false);
          break;
        case 'Home':
          e.preventDefault();
          fromKeyboard.current = true;
          if (totalNavigable > 0) setFocusedIndex(0);
          break;
        case 'End':
          e.preventDefault();
          fromKeyboard.current = true;
          if (totalNavigable > 0) setFocusedIndex(totalNavigable - 1);
          break;
      }
    };

    const getOptionId = (optIdx: number) => `${listboxId}-option-${optIdx}`;
    const activeDescendant =
      focusedIndex >= 0 && focusedIndex < totalNavigable ? getOptionId(focusedIndex) : undefined;

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            ref={ref}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-controls={open ? listboxId : undefined}
            id={id}
            className={cn(
              'flex h-10 w-full items-center justify-between rounded-lg',
              'border border-border bg-card px-3 py-2 text-sm',
              'text-foreground',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'transition-colors duration-200',
              className
            )}
          >
            <span className={cn('flex items-center gap-2 truncate', !selectedOption && !value && 'text-muted-foreground')}>
              {selectedOption?.icon && (
                <span className="shrink-0 text-muted-foreground">{selectedOption.icon}</span>
              )}
              <span className="truncate">{displayValue}</span>
              {selectedOption?.badge && <span className="shrink-0">{selectedOption.badge}</span>}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          sideOffset={4}
          onKeyDown={handleKeyDown}
        >
          {/* Search bar */}
          <div className="flex items-center border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              role="searchbox"
              aria-controls={listboxId}
              aria-activedescendant={activeDescendant}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="flex h-10 w-full bg-transparent py-3 px-2 text-sm placeholder:text-muted-foreground focus:outline-none"
            />
          </div>

          {/* Scroll container — fixed height so PopoverContent never resizes and repositions.
              onWheelCapture stops react-remove-scroll (used by Radix) from calling
              preventDefault() on wheel events before they reach this element. */}
          <div
            ref={setScrollEl}
            style={{ height: LIST_HEIGHT, overflowY: 'scroll' }}
            className="p-1"
            onWheelCapture={(e) => e.stopPropagation()}
          >
            {isLoading && (
              <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
                <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {loadingMessage}
              </div>
            )}

            {!isLoading && !hasItems && (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                {emptyMessage}
              </div>
            )}

            {!isLoading && hasItems && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={searchPlaceholder || placeholder}
                style={{ height: virtualizer.getTotalSize(), position: 'relative', listStyle: 'none', margin: 0, padding: 0 }}
              >
                {virtualizer.getVirtualItems().map((vItem) => {
                  const row = virtualRows[vItem.index];
                  if (!row) return null;

                  const itemStyle: React.CSSProperties = {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: `${vItem.size}px`,
                    transform: `translateY(${vItem.start}px)`,
                  };

                  if (row.kind === 'header') {
                    return (
                      <li
                        key={vItem.key}
                        role="presentation"
                        aria-hidden="true"
                        style={itemStyle}
                        className="flex items-center px-2 text-xs font-semibold text-muted-foreground"
                      >
                        {row.label}
                      </li>
                    );
                  }

                  if (row.kind === 'option') {
                    const { option, optionIndex } = row;
                    const isFocused = focusedIndex === optionIndex;
                    const isSelected = value === option.value;
                    return (
                      <li
                        key={vItem.key}
                        id={getOptionId(optionIndex)}
                        role="option"
                        aria-selected={isSelected}
                        style={itemStyle}
                        onClick={() => handleSelect(option.value)}
                        onMouseEnter={() => setFocusedIndex(optionIndex)}
                        className={cn(
                          'relative flex items-center rounded-md pl-8 pr-2 text-sm cursor-default select-none',
                          'hover:bg-accent hover:text-accent-foreground',
                          isFocused && 'bg-accent text-accent-foreground'
                        )}
                      >
                        <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                          {isSelected && <Check className="h-4 w-4 text-primary" />}
                        </span>
                        <span className="flex flex-1 items-center gap-2 truncate">
                          {option.icon && <span className="shrink-0 text-muted-foreground">{option.icon}</span>}
                          <span className="truncate">{option.label}</span>
                          {option.badge && <span className="shrink-0">{option.badge}</span>}
                        </span>
                      </li>
                    );
                  }

                  // custom entry
                  const isFocused = focusedIndex === filteredOptions.length;
                  return (
                    <li
                      key={vItem.key}
                      id={getOptionId(filteredOptions.length)}
                      role="option"
                      aria-selected={false}
                      style={itemStyle}
                      onClick={() => handleSelect(row.value)}
                      onMouseEnter={() => setFocusedIndex(filteredOptions.length)}
                      className={cn(
                        'flex items-center gap-2 rounded-md pl-3 pr-2 text-sm cursor-default select-none',
                        'border-t border-border',
                        'hover:bg-accent hover:text-accent-foreground',
                        isFocused && 'bg-accent text-accent-foreground'
                      )}
                    >
                      <span className="text-muted-foreground text-xs shrink-0">{customValueLabel}</span>
                      <span className="truncate font-mono text-xs">{row.value}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);

Combobox.displayName = 'Combobox';

export { Combobox };

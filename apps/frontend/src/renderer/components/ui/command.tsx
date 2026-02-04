/**
 * Command component - A simple searchable list for task selection
 *
 * Provides a similar API to the shadcn/ui Command component but with
 * a simpler implementation that doesn't require the cmdk library.
 */

import * as React from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';

// Context for sharing filter state
const CommandContext = React.createContext<{
  search: string;
  setSearch: (value: string) => void;
}>({
  search: '',
  setSearch: () => {},
});

// Main Command container
interface CommandProps extends React.HTMLAttributes<HTMLDivElement> {}

const Command = React.forwardRef<HTMLDivElement, CommandProps>(
  ({ className, children, ...props }, ref) => {
    const [search, setSearch] = React.useState('');

    return (
      <CommandContext.Provider value={{ search, setSearch }}>
        <div
          ref={ref}
          className={cn(
            'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
            className
          )}
          {...props}
        >
          {children}
        </div>
      </CommandContext.Provider>
    );
  }
);
Command.displayName = 'Command';

// Search input
interface CommandInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {}

const CommandInput = React.forwardRef<HTMLInputElement, CommandInputProps>(
  ({ className, placeholder, ...props }, ref) => {
    const { search, setSearch } = React.useContext(CommandContext);

    return (
      <div className="flex items-center border-b px-3" cmdk-input-wrapper="">
        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
        <input
          ref={ref}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            'flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none',
            'placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          placeholder={placeholder}
          {...props}
        />
      </div>
    );
  }
);
CommandInput.displayName = 'CommandInput';

// List container
interface CommandListProps extends React.HTMLAttributes<HTMLDivElement> {}

const CommandList = React.forwardRef<HTMLDivElement, CommandListProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
      {...props}
    />
  )
);
CommandList.displayName = 'CommandList';

// Empty state
interface CommandEmptyProps extends React.HTMLAttributes<HTMLDivElement> {}

const CommandEmpty = React.forwardRef<HTMLDivElement, CommandEmptyProps>(
  ({ className, ...props }, ref) => {
    const { search } = React.useContext(CommandContext);
    const [isEmpty, setIsEmpty] = React.useState(false);

    // Check if parent CommandList has no visible children
    React.useEffect(() => {
      const checkEmpty = () => {
        const list = ref && 'current' in ref ? ref.current?.parentElement : null;
        if (list) {
          const items = list.querySelectorAll('[cmdk-item]');
          const visibleItems = Array.from(items).filter(
            (item) => !item.hasAttribute('data-hidden')
          );
          setIsEmpty(visibleItems.length === 0 && search.length > 0);
        }
      };
      // Small delay to allow rendering
      const timer = setTimeout(checkEmpty, 10);
      return () => clearTimeout(timer);
    }, [search, ref]);

    if (!isEmpty) return null;

    return (
      <div
        ref={ref}
        className={cn('py-6 text-center text-sm', className)}
        {...props}
      />
    );
  }
);
CommandEmpty.displayName = 'CommandEmpty';

// Group
interface CommandGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  heading?: string;
}

const CommandGroup = React.forwardRef<HTMLDivElement, CommandGroupProps>(
  ({ className, heading, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'overflow-hidden p-1 text-foreground',
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-muted-foreground',
        className
      )}
      {...props}
    >
      {heading && (
        <div cmdk-group-heading="" className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
          {heading}
        </div>
      )}
      {children}
    </div>
  )
);
CommandGroup.displayName = 'CommandGroup';

// Separator
interface CommandSeparatorProps extends React.HTMLAttributes<HTMLDivElement> {}

const CommandSeparator = React.forwardRef<HTMLDivElement, CommandSeparatorProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  )
);
CommandSeparator.displayName = 'CommandSeparator';

// Item
interface CommandItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  value?: string;
  onSelect?: (value: string) => void;
  disabled?: boolean;
}

const CommandItem = React.forwardRef<HTMLDivElement, CommandItemProps>(
  ({ className, value = '', onSelect, disabled, children, ...props }, ref) => {
    const { search } = React.useContext(CommandContext);

    // Filter based on search
    const isHidden = search && !value.toLowerCase().includes(search.toLowerCase());

    if (isHidden) {
      return (
        <div ref={ref} data-hidden="" style={{ display: 'none' }} cmdk-item="">
          {children}
        </div>
      );
    }

    return (
      <div
        ref={ref}
        cmdk-item=""
        className={cn(
          'relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
          'hover:bg-accent hover:text-accent-foreground cursor-pointer',
          'aria-selected:bg-accent aria-selected:text-accent-foreground',
          disabled && 'pointer-events-none opacity-50',
          className
        )}
        onClick={() => !disabled && onSelect?.(value)}
        data-disabled={disabled ? '' : undefined}
        {...props}
      >
        {children}
      </div>
    );
  }
);
CommandItem.displayName = 'CommandItem';

// Shortcut hint
interface CommandShortcutProps extends React.HTMLAttributes<HTMLSpanElement> {}

const CommandShortcut = React.forwardRef<HTMLSpanElement, CommandShortcutProps>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground',
        className
      )}
      {...props}
    />
  )
);
CommandShortcut.displayName = 'CommandShortcut';

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
};

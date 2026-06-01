import { Terminal, ExternalLink, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../ui/dropdown-menu';

interface TerminalDropdownProps {
  onOpenInbuilt: () => void;
  onOpenExternal: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Dropdown button for selecting terminal type (inbuilt or external)
 */
export function TerminalDropdown({
  onOpenInbuilt,
  onOpenExternal,
  disabled = false,
  className
}: TerminalDropdownProps) {
  const { t } = useTranslation('taskReview');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className={className}
          title={t('terminal.openTerminal')}
        >
          <Terminal className="h-3.5 w-3.5" />
          <ChevronDown className="h-3 w-3 ms-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpenInbuilt}>
          <Terminal className="h-4 w-4 me-2" />
          {t('terminal.openInbuilt')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenExternal}>
          <ExternalLink className="h-4 w-4 me-2" />
          {t('terminal.openExternal')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

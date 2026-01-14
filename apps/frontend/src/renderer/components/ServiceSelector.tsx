/**
 * ServiceSelector - Component for selecting which service/folder to work in
 *
 * This allows users to specify which part of the codebase the AI should focus on.
 * The selection is prepended to the task description to provide context.
 *
 * Uses the project index from the context store to get the list of available services.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderTree, ChevronDown, MapPin } from 'lucide-react';
import { Button } from './ui/button';
import { Label } from './ui/label';
import { Checkbox } from './ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { cn } from '../lib/utils';
import type { ProjectIndex } from '../../shared/types';

interface ServiceSelectorProps {
  value: string;
  onChange: (value: string) => void;
  projectIndex: ProjectIndex | null;
  disabled?: boolean;
}

export function ServiceSelector({ value, onChange, projectIndex, disabled }: ServiceSelectorProps) {
  const { t } = useTranslation(['tasks']);
  const [isOpen, setIsOpen] = useState(false);

  // Build service options from projectIndex
  const services = projectIndex?.services
    ? Object.entries(projectIndex.services).map(([key, service]) => ({
        id: key,
        label: service.name || key,
        path: service.path,
        description: service.type || 'service'
      }))
    : [];

  // Add "All Codebase" option at the beginning
  const allOptions = [
    { id: '', label: 'All Codebase', path: '', description: 'Work across the entire codebase' },
    ...services
  ];

  const selectedService = allOptions.find(s => s.id === value) || allOptions[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id="service-context-toggle"
          checked={value !== ''}
          onCheckedChange={(checked) => {
            if (checked && services.length > 0) {
              // Enable with first service selected
              onChange(services[0].id);
            } else {
              // Disable
              onChange('');
            }
          }}
          disabled={disabled || services.length === 0}
        />
        <div className="flex-1">
          <Label
            htmlFor="service-context-toggle"
            className="text-sm font-normal cursor-pointer"
          >
            {t('tasks:serviceSelector.label')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {services.length === 0
              ? 'No services detected in project. Refresh the Context tab to detect services.'
              : t('tasks:serviceSelector.helpText')
            }
          </p>
        </div>
      </div>

      {value !== '' && services.length > 0 && (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={isOpen}
              disabled={disabled}
              className="w-full justify-between"
            >
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <span>{selectedService.label}</span>
                {selectedService.description !== 'service' && (
                  <span className="text-xs text-muted-foreground">({selectedService.description})</span>
                )}
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[300px] p-0">
            <div className="max-h-[300px] overflow-y-auto">
              {services.map((service) => (
                <button
                  key={service.id}
                  className={cn(
                    'flex w-full flex-col items-start px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground',
                    value === service.id && 'bg-accent'
                  )}
                  onClick={() => {
                    onChange(service.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{service.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {service.path}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Get the service context prefix to add to a task description
 */
export function getServiceContextPrefix(serviceId: string, projectIndex: ProjectIndex | null): string {
  if (!serviceId || !projectIndex?.services) return '';

  const service = Object.entries(projectIndex.services).find(([key]) => key === serviceId);
  if (!service) return '';

  const [_, serviceInfo] = service;
  const servicePath = serviceInfo.path;

  return `You have access to the full codebase as context, but for this task you need to work in the "${servicePath}" folder. `;
}

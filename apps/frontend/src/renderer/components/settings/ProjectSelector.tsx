import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select';
import { Separator } from '../ui/separator';
import { useProjectStore, removeProject } from '../../stores/project-store';
import { AddProjectModal } from '../AddProjectModal';
import type { Project } from '../../../shared/types';

interface ProjectSelectorProps {
  selectedProjectId: string | null;
  onProjectChange: (projectId: string | null) => void;
  onProjectAdded?: (project: Project, needsInit: boolean) => void;
}

export function ProjectSelector({
  selectedProjectId,
  onProjectChange,
  onProjectAdded
}: ProjectSelectorProps) {
  const { t } = useTranslation('settings');
  const projects = useProjectStore((state) => state.projects);
  const [showAddModal, setShowAddModal] = useState(false);
  const [open, setOpen] = useState(false);

  const handleValueChange = (value: string) => {
    if (value === '__add_new__') {
      setShowAddModal(true);
      setOpen(false);
    } else {
      onProjectChange(value || null);
      setOpen(false);
    }
  };

  const handleRemoveProject = useCallback(async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    await removeProject(projectId);
    setOpen(false);
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <>
      <Select
        value={selectedProjectId || ''}
        onValueChange={handleValueChange}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger className="w-full [&_span]:truncate">
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SelectValue placeholder={t('projectSelector.selectPlaceholder')} className="truncate min-w-0 flex-1" />
          </div>
        </SelectTrigger>
        <SelectContent className="min-w-(--radix-select-trigger-width) max-w-(--radix-select-trigger-width)">
          {projects.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              <p>{t('projectSelector.noProjects')}</p>
            </div>
          ) : (
            projects.map((project) => (
              <div key={project.id} className="relative flex items-center">
                <SelectItem value={project.id} className="flex-1 pr-10">
                  <span className="truncate" title={`${project.name} - ${project.path}`}>
                    {project.name}
                  </span>
                </SelectItem>
                <button
                  type="button"
                  className="absolute right-2 flex h-6 w-6 items-center justify-center rounded-md hover:bg-destructive/10 transition-colors"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                  }}
                  onClick={(e) => handleRemoveProject(project.id, e)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </button>
              </div>
            ))
          )}
          <Separator className="my-1" />
          <SelectItem value="__add_new__">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 shrink-0" />
              <span>{t('projectSelector.addProject')}</span>
            </div>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Project path - shown when project is selected */}
      {selectedProject && (
        <div className="mt-2">
          <span
            className="truncate block text-xs text-muted-foreground"
            title={selectedProject.path}
          >
            {selectedProject.path}
          </span>
        </div>
      )}

      <AddProjectModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onProjectAdded={(project, needsInit) => {
          onProjectChange(project.id);
          onProjectAdded?.(project, needsInit);
        }}
      />
    </>
  );
}

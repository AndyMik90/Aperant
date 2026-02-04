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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
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
  const { t } = useTranslation(['settings', 'common']);
  const projects = useProjectStore((state) => state.projects);
  const [showAddModal, setShowAddModal] = useState(false);
  const [open, setOpen] = useState(false);

  // FIX-25: Project removal dialog state
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);
  const [projectToRemove, setProjectToRemove] = useState<Project | null>(null);
  const [deleteDataOption, setDeleteDataOption] = useState<'keep' | 'delete'>('keep');
  const [isRemoving, setIsRemoving] = useState(false);

  const handleValueChange = (value: string) => {
    if (value === '__add_new__') {
      setShowAddModal(true);
      setOpen(false);
    } else {
      onProjectChange(value || null);
      setOpen(false);
    }
  };

  // FIX-25: Show removal dialog instead of removing immediately
  const handleRemoveProject = useCallback((project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setProjectToRemove(project);
    setDeleteDataOption('keep'); // Reset to default option
    setRemoveDialogOpen(true);
    setOpen(false);
  }, []);

  // FIX-25: Handle confirmed removal
  const handleConfirmRemove = useCallback(async () => {
    if (!projectToRemove) return;

    setIsRemoving(true);
    try {
      const deleteData = deleteDataOption === 'delete';
      await removeProject(projectToRemove.id, deleteData);
      setRemoveDialogOpen(false);
      setProjectToRemove(null);
    } finally {
      setIsRemoving(false);
    }
  }, [projectToRemove, deleteDataOption]);

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
            <SelectValue placeholder="Select a project..." className="truncate min-w-0 flex-1" />
          </div>
        </SelectTrigger>
        <SelectContent className="min-w-(--radix-select-trigger-width) max-w-(--radix-select-trigger-width)">
          {projects.length === 0 ? (
            <div className="px-2 py-4 text-center text-sm text-muted-foreground">
              <p>No projects yet</p>
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
                  onClick={(e) => handleRemoveProject(project, e)}
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
              <span>Add Project...</span>
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

      {/* FIX-25: Project removal dialog with two options */}
      <Dialog open={removeDialogOpen} onOpenChange={(open) => {
        if (!isRemoving) {
          setRemoveDialogOpen(open);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings:projectRemoval.title')}</DialogTitle>
            <DialogDescription>
              {t('settings:projectRemoval.description', { name: projectToRemove?.name })}
            </DialogDescription>
          </DialogHeader>

          <RadioGroup
            value={deleteDataOption}
            onValueChange={(value) => setDeleteDataOption(value as 'keep' | 'delete')}
            className="space-y-3 py-4"
          >
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="keep" id="keep" />
              <div className="grid gap-1">
                <Label htmlFor="keep" className="font-medium">
                  {t('settings:projectRemoval.keepOption')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings:projectRemoval.keepDescription')}
                </p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <RadioGroupItem value="delete" id="delete" />
              <div className="grid gap-1">
                <Label htmlFor="delete" className="font-medium text-destructive">
                  {t('settings:projectRemoval.deleteOption')}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t('settings:projectRemoval.deleteDescription')}
                </p>
              </div>
            </div>
          </RadioGroup>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveDialogOpen(false)}
              disabled={isRemoving}
            >
              {t('common:buttons.cancel')}
            </Button>
            <Button
              variant={deleteDataOption === 'delete' ? 'destructive' : 'default'}
              onClick={handleConfirmRemove}
              disabled={isRemoving}
            >
              {isRemoving ? t('common:buttons.removing') : t('common:buttons.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

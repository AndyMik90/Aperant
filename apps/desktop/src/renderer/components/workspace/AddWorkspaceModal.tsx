import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import type { Project } from '../../../shared/types';

type ProjectRole = 'backend' | 'frontend' | 'mobile' | 'shared' | 'api' | 'worker' | 'other';

interface WorkspaceProject {
  projectId: string;
  role: ProjectRole;
}

interface Workspace {
  id: string;
  name: string;
  description?: string;
  projects?: WorkspaceProject[];
}

type IPCResult<T> = { success: boolean; data?: T; error?: string };

type WorkspaceApi = {
  createWorkspace: (
    name: string,
    description?: string,
    options?: { validationEnabled?: boolean; validationTriggers?: string[] }
  ) => Promise<IPCResult<Workspace>>;
  addProjectToWorkspace: (
    workspaceId: string,
    projectId: string,
    role: ProjectRole
  ) => Promise<IPCResult<Workspace>>;
  getWorkspace: (workspaceId: string) => Promise<IPCResult<Workspace>>;
};

interface AddWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  onCreated: (workspace: Workspace) => void;
}

interface SelectedProject {
  projectId: string;
  role: ProjectRole;
}

const ROLE_OPTIONS: { value: ProjectRole; label: string; description: string }[] = [
  { value: 'backend', label: 'Backend', description: 'API server, services' },
  { value: 'frontend', label: 'Frontend', description: 'Web application' },
  { value: 'mobile', label: 'Mobile', description: 'Mobile app' },
  { value: 'shared', label: 'Shared', description: 'Shared types/utils' },
  { value: 'api', label: 'API Gateway', description: 'Gateway, BFF' },
  { value: 'worker', label: 'Worker', description: 'Background jobs' },
  { value: 'other', label: 'Other', description: 'Other project type' },
];

export function AddWorkspaceModal({
  open,
  onOpenChange,
  projects,
  onCreated,
}: AddWorkspaceModalProps) {
  const { t } = useTranslation('common');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<SelectedProject[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableProjects = projects.filter(
    (p) => !selectedProjects.some((sp) => sp.projectId === p.id)
  );

  const handleAddProject = (projectId: string) => {
    setSelectedProjects((prev) => [
      ...prev,
      { projectId, role: 'other' as ProjectRole },
    ]);
  };

  const handleRemoveProject = (projectId: string) => {
    setSelectedProjects((prev) => prev.filter((p) => p.projectId !== projectId));
  };

  const handleRoleChange = (projectId: string, role: ProjectRole) => {
    setSelectedProjects((prev) =>
      prev.map((p) => (p.projectId === projectId ? { ...p, role } : p))
    );
  };

  const getProjectName = (projectId: string): string => {
    const project = projects.find((p) => p.id === projectId);
    return project?.name || projectId;
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Workspace name is required');
      return;
    }

    const workspaceApi = window.electronAPI as unknown as Partial<WorkspaceApi>;
    if (!workspaceApi.createWorkspace || !workspaceApi.addProjectToWorkspace || !workspaceApi.getWorkspace) {
      setError('Workspace API not available');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      // Create the workspace
      const result = await workspaceApi.createWorkspace(
        name.trim(),
        description.trim() || undefined,
        {
          validationEnabled: true,
          validationTriggers: ['spec_creation', 'before_merge'],
        }
      );

      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to create workspace');
      }

      const workspace = result.data;

      // Add projects to the workspace
      for (const selected of selectedProjects) {
        await workspaceApi.addProjectToWorkspace(
          workspace.id,
          selected.projectId,
          selected.role
        );
      }

      // Reload the workspace with members
      const reloadResult = await workspaceApi.getWorkspace(workspace.id);
      const finalWorkspace = reloadResult.success && reloadResult.data ? reloadResult.data : workspace;

      onCreated(finalWorkspace);
      resetForm();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedProjects([]);
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Create Workspace
          </DialogTitle>
          <DialogDescription>
            Group related projects together for cross-repo specs and validation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              placeholder="My App Workspace"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Description */}
          <div className="grid gap-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Backend, frontend, and mobile apps for My App"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {/* Add projects */}
          <div className="grid gap-2">
            <Label>Projects</Label>
            {availableProjects.length > 0 ? (
              <Select onValueChange={handleAddProject}>
                <SelectTrigger>
                  <SelectValue placeholder="Add a project..." />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                {selectedProjects.length > 0
                  ? 'All projects have been added'
                  : 'No projects available'}
              </p>
            )}
          </div>

          {/* Selected projects */}
          {selectedProjects.length > 0 && (
            <div className="grid gap-2">
              {selectedProjects.map((selected) => (
                <div
                  key={selected.projectId}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <span className="flex-1 text-sm font-medium">
                    {getProjectName(selected.projectId)}
                  </span>
                  <Select
                    value={selected.role}
                    onValueChange={(value) =>
                      handleRoleChange(selected.projectId, value as ProjectRole)
                    }
                  >
                    <SelectTrigger className="w-[130px] h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleRemoveProject(selected.projectId)}
                    aria-label={t('accessibility.removeAriaLabel')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !name.trim()}>
            {isCreating ? 'Creating...' : 'Create Workspace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

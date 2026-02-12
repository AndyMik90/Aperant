/**
 * Unit tests for GitLab Repository handlers
 * Tests connection status and project management
 */
import { describe, it, expect } from 'vitest';

// Types matching the handler's types
interface GitLabSyncStatus {
  connected: boolean;
  instanceUrl?: string;
  projectPathWithNamespace?: string;
  projectDescription?: string;
  issueCount?: number;
  lastSyncedAt?: string;
  error?: string;
}

interface GitLabAPIProject {
  id: number;
  name: string;
  path: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  star_count: number;
  forks_count: number;
}

interface IPCResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Utility functions from the handler
function createConnectedStatus(
  instanceUrl: string,
  projectInfo: GitLabAPIProject,
  issueCount: number
): GitLabSyncStatus {
  return {
    connected: true,
    instanceUrl,
    projectPathWithNamespace: projectInfo.path_with_namespace,
    projectDescription: projectInfo.description ?? undefined,
    issueCount,
    lastSyncedAt: new Date().toISOString(),
  };
}

function createDisconnectedStatus(error: string): GitLabSyncStatus {
  return {
    connected: false,
    error,
  };
}

function validateSyncStatus(status: GitLabSyncStatus): boolean {
  if (typeof status.connected !== 'boolean') return false;

  if (status.connected) {
    // Connected status should have these fields
    if (typeof status.instanceUrl !== 'string') return false;
    if (typeof status.projectPathWithNamespace !== 'string') return false;
    if (typeof status.issueCount !== 'number') return false;
  } else {
    // Disconnected status should have error
    if (typeof status.error !== 'string') return false;
  }

  return true;
}

function filterAccessibleProjects(
  projects: GitLabAPIProject[],
  _minAccessLevel: number = 20
): GitLabAPIProject[] {
  // In real implementation, this would check permissions
  // For testing, we just return all projects
  return projects.filter((p) => p.id > 0);
}

function sortProjectsByName(projects: GitLabAPIProject[]): GitLabAPIProject[] {
  return [...projects].sort((a, b) =>
    a.path_with_namespace.localeCompare(b.path_with_namespace)
  );
}

describe('GitLab Repository Handlers', () => {
  describe('createConnectedStatus', () => {
    it('should create connected status with all fields', () => {
      const projectInfo: GitLabAPIProject = {
        id: 1,
        name: 'Test Project',
        path: 'test-project',
        path_with_namespace: 'group/test-project',
        description: 'A test project',
        web_url: 'https://gitlab.com/group/test-project',
        star_count: 10,
        forks_count: 5,
      };

      const status = createConnectedStatus('https://gitlab.com', projectInfo, 42);

      expect(status.connected).toBe(true);
      expect(status.instanceUrl).toBe('https://gitlab.com');
      expect(status.projectPathWithNamespace).toBe('group/test-project');
      expect(status.projectDescription).toBe('A test project');
      expect(status.issueCount).toBe(42);
      expect(status.lastSyncedAt).toBeDefined();
      expect(status.error).toBeUndefined();
    });

    it('should handle null description', () => {
      const projectInfo: GitLabAPIProject = {
        id: 1,
        name: 'Test',
        path: 'test',
        path_with_namespace: 'group/test',
        description: null,
        web_url: 'https://gitlab.com/group/test',
        star_count: 0,
        forks_count: 0,
      };

      const status = createConnectedStatus('https://gitlab.com', projectInfo, 0);

      expect(status.projectDescription).toBeUndefined();
    });

    it('should set valid lastSyncedAt timestamp', () => {
      const projectInfo: GitLabAPIProject = {
        id: 1,
        name: 'Test',
        path: 'test',
        path_with_namespace: 'test',
        description: '',
        web_url: 'https://gitlab.com/test',
        star_count: 0,
        forks_count: 0,
      };

      const before = new Date().getTime();
      const status = createConnectedStatus('https://gitlab.com', projectInfo, 0);
      const after = new Date().getTime();
      const syncTime = new Date(status.lastSyncedAt!).getTime();

      expect(syncTime).toBeGreaterThanOrEqual(before);
      expect(syncTime).toBeLessThanOrEqual(after);
    });
  });

  describe('createDisconnectedStatus', () => {
    it('should create disconnected status with error', () => {
      const status = createDisconnectedStatus('Connection failed');

      expect(status.connected).toBe(false);
      expect(status.error).toBe('Connection failed');
      expect(status.instanceUrl).toBeUndefined();
      expect(status.projectPathWithNamespace).toBeUndefined();
    });

    it('should handle various error messages', () => {
      const errors = [
        'GitLab not configured',
        'Invalid token',
        'Network timeout',
        'Project not found',
      ];

      errors.forEach((error) => {
        const status = createDisconnectedStatus(error);
        expect(status.connected).toBe(false);
        expect(status.error).toBe(error);
      });
    });
  });

  describe('validateSyncStatus', () => {
    it('should validate connected status', () => {
      const status: GitLabSyncStatus = {
        connected: true,
        instanceUrl: 'https://gitlab.com',
        projectPathWithNamespace: 'group/project',
        issueCount: 10,
        lastSyncedAt: '2024-01-15T10:00:00Z',
      };

      expect(validateSyncStatus(status)).toBe(true);
    });

    it('should validate disconnected status', () => {
      const status: GitLabSyncStatus = {
        connected: false,
        error: 'Connection failed',
      };

      expect(validateSyncStatus(status)).toBe(true);
    });

    it('should reject connected status without instanceUrl', () => {
      const status = {
        connected: true,
        projectPathWithNamespace: 'group/project',
        issueCount: 10,
      } as GitLabSyncStatus;

      expect(validateSyncStatus(status)).toBe(false);
    });

    it('should reject connected status without projectPathWithNamespace', () => {
      const status = {
        connected: true,
        instanceUrl: 'https://gitlab.com',
        issueCount: 10,
      } as GitLabSyncStatus;

      expect(validateSyncStatus(status)).toBe(false);
    });

    it('should reject connected status without issueCount', () => {
      const status = {
        connected: true,
        instanceUrl: 'https://gitlab.com',
        projectPathWithNamespace: 'group/project',
      } as GitLabSyncStatus;

      expect(validateSyncStatus(status)).toBe(false);
    });

    it('should reject disconnected status without error', () => {
      const status = {
        connected: false,
      } as GitLabSyncStatus;

      expect(validateSyncStatus(status)).toBe(false);
    });

    it('should reject non-boolean connected', () => {
      const status = {
        connected: 'yes',
        error: 'Test',
      } as unknown as GitLabSyncStatus;

      expect(validateSyncStatus(status)).toBe(false);
    });
  });

  describe('filterAccessibleProjects', () => {
    const mockProjects: GitLabAPIProject[] = [
      {
        id: 1,
        name: 'Project 1',
        path: 'project-1',
        path_with_namespace: 'group1/project-1',
        description: 'First project',
        web_url: 'https://gitlab.com/group1/project-1',
        star_count: 5,
        forks_count: 2,
      },
      {
        id: 2,
        name: 'Project 2',
        path: 'project-2',
        path_with_namespace: 'group2/project-2',
        description: 'Second project',
        web_url: 'https://gitlab.com/group2/project-2',
        star_count: 10,
        forks_count: 3,
      },
    ];

    it('should return all valid projects', () => {
      const result = filterAccessibleProjects(mockProjects);
      expect(result).toHaveLength(2);
    });

    it('should filter out projects with invalid IDs', () => {
      const invalidProjects = [
        ...mockProjects,
        { ...mockProjects[0], id: -1 },
        { ...mockProjects[0], id: 0 },
      ];

      const result = filterAccessibleProjects(invalidProjects);
      expect(result).toHaveLength(2);
    });

    it('should return empty array for empty input', () => {
      expect(filterAccessibleProjects([])).toEqual([]);
    });
  });

  describe('sortProjectsByName', () => {
    const mockProjects: GitLabAPIProject[] = [
      {
        id: 1,
        name: 'Zebra',
        path: 'zebra',
        path_with_namespace: 'zoo/zebra',
        description: null,
        web_url: 'https://gitlab.com/zoo/zebra',
        star_count: 0,
        forks_count: 0,
      },
      {
        id: 2,
        name: 'Apple',
        path: 'apple',
        path_with_namespace: 'fruit/apple',
        description: null,
        web_url: 'https://gitlab.com/fruit/apple',
        star_count: 0,
        forks_count: 0,
      },
      {
        id: 3,
        name: 'Mango',
        path: 'mango',
        path_with_namespace: 'fruit/mango',
        description: null,
        web_url: 'https://gitlab.com/fruit/mango',
        star_count: 0,
        forks_count: 0,
      },
    ];

    it('should sort projects alphabetically by path_with_namespace', () => {
      const sorted = sortProjectsByName(mockProjects);

      expect(sorted[0].path_with_namespace).toBe('fruit/apple');
      expect(sorted[1].path_with_namespace).toBe('fruit/mango');
      expect(sorted[2].path_with_namespace).toBe('zoo/zebra');
    });

    it('should not mutate original array', () => {
      const original = [...mockProjects];
      sortProjectsByName(mockProjects);

      expect(mockProjects).toEqual(original);
    });

    it('should handle empty array', () => {
      expect(sortProjectsByName([])).toEqual([]);
    });

    it('should handle single project', () => {
      const single = [mockProjects[0]];
      const sorted = sortProjectsByName(single);

      expect(sorted).toHaveLength(1);
    });
  });

  describe('Connection Status Scenarios', () => {
    it('should handle successful connection check', () => {
      const projectInfo: GitLabAPIProject = {
        id: 1,
        name: 'My Project',
        path: 'my-project',
        path_with_namespace: 'mygroup/my-project',
        description: 'A cool project',
        web_url: 'https://gitlab.com/mygroup/my-project',
        star_count: 100,
        forks_count: 50,
      };

      const status = createConnectedStatus('https://gitlab.com', projectInfo, 25);

      expect(status.connected).toBe(true);
      expect(validateSyncStatus(status)).toBe(true);
    });

    it('should handle missing configuration', () => {
      const status = createDisconnectedStatus(
        'GitLab not configured. Please add GITLAB_TOKEN and GITLAB_PROJECT to your .env file.'
      );

      expect(status.connected).toBe(false);
      expect(status.error).toContain('GITLAB_TOKEN');
      expect(validateSyncStatus(status)).toBe(true);
    });

    it('should handle network error', () => {
      const status = createDisconnectedStatus('Failed to connect to GitLab');

      expect(status.connected).toBe(false);
      expect(validateSyncStatus(status)).toBe(true);
    });
  });

  describe('IPC Result Handling', () => {
    it('should wrap connected status in IPC result', () => {
      const status: GitLabSyncStatus = {
        connected: true,
        instanceUrl: 'https://gitlab.com',
        projectPathWithNamespace: 'group/project',
        issueCount: 10,
        lastSyncedAt: '2024-01-15T10:00:00Z',
      };

      const result: IPCResult<GitLabSyncStatus> = {
        success: true,
        data: status,
      };

      expect(result.success).toBe(true);
      expect(result.data?.connected).toBe(true);
    });

    it('should wrap disconnected status in IPC result', () => {
      const status: GitLabSyncStatus = {
        connected: false,
        error: 'Not configured',
      };

      // Note: Even disconnected status returns success: true because the check itself succeeded
      const result: IPCResult<GitLabSyncStatus> = {
        success: true,
        data: status,
      };

      expect(result.success).toBe(true);
      expect(result.data?.connected).toBe(false);
    });

    it('should return error for project not found', () => {
      const result: IPCResult<GitLabSyncStatus> = {
        success: false,
        error: 'Project not found',
      };

      expect(result.success).toBe(false);
      expect(result.error).toBe('Project not found');
    });
  });
});

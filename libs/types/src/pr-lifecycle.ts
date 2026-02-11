/**
 * PR lifecycle types
 *
 * @stub Phase 4 — All fields optional until PR lifecycle is implemented.
 */

/** @stub Phase 4 */
export type ProviderType = 'github' | 'gitlab' | 'bitbucket';

/** @stub Phase 4 */
export interface UnifiedPR {
  id?: string;
  provider?: ProviderType;
  number?: number;
  title?: string;
  description?: string;
  state?: string;
  author?: string;
  sourceBranch?: string;
  targetBranch?: string;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

/** @stub Phase 4 */
export interface UnifiedPREvent {
  id?: string;
  prId?: string;
  type?: string;
  actor?: string;
  content?: string;
  createdAt?: string;
}

/** @stub Phase 4 */
export interface Installation {
  id?: string;
  provider?: ProviderType;
  accountId?: string;
  accountName?: string;
  installedAt?: string;
}

/** @stub Phase 4 */
export interface PRQueueItem {
  id?: string;
  prId?: string;
  priority?: number;
  status?: string;
  addedAt?: string;
}

/** @stub Phase 4 */
export interface Contributor {
  id?: string;
  login?: string;
  name?: string;
  avatarUrl?: string;
  provider?: ProviderType;
}

/** @stub Phase 4 */
export interface FileChange {
  path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

/** @stub Phase 4 */
export interface CIStatus {
  id?: string;
  prId?: string;
  name?: string;
  status?: string;
  conclusion?: string;
  url?: string;
  startedAt?: string;
  completedAt?: string;
}

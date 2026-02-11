/**
 * Team management types
 */

import type { Tier } from './cloud';

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: TeamRole;
  avatar?: string;
  joinedAt: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  tier: Tier;
  ownerId: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
}

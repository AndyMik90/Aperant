/**
 * Cloud platform types
 */

export type Tier = 'free' | 'pro' | 'team' | 'enterprise';

export type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export interface CloudUser {
  id: string;
  email: string;
  name: string;
  tier: Tier;
  avatar?: string;
  subscription: SubscriptionStatus;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  requiredTier: Tier;
}

export interface TierLimits {
  maxTasks: number;
  maxProjects: number;
  maxTerminals: number;
  maxTeamMembers: number;
  maxStorageMb: number;
}

export interface Usage {
  tasks: number;
  projects: number;
  terminals: number;
  teamMembers: number;
  storageMb: number;
}

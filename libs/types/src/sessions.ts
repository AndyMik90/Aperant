/**
 * Enhanced session types
 *
 * @stub Phase 6 — All fields optional until enhanced sessions are implemented.
 */

/** @stub Phase 6 */
export interface AgentSessionEnhanced {
  id?: string;
  userId?: string;
  teamId?: string;
  projectId?: string;
  model?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  tokensUsed?: number;
  costEstimate?: number;
  metadata?: Record<string, unknown>;
}

/** @stub Phase 6 */
export interface PersonaEnhanced {
  id?: string;
  name?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  thinkingLevel?: string;
  isShared?: boolean;
  createdBy?: string;
  teamId?: string;
  createdAt?: string;
  updatedAt?: string;
}

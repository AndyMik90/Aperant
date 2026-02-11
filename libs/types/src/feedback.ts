/**
 * Feedback and community types
 *
 * @stub Phase 5 — All fields optional until feedback system is implemented.
 */

/** @stub Phase 5 */
export interface FeedbackItem {
  id?: string;
  userId?: string;
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  votes?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** @stub Phase 5 */
export interface FeedbackSettings {
  enabled?: boolean;
  allowAnonymous?: boolean;
  categories?: string[];
  requireApproval?: boolean;
}

/** @stub Phase 5 */
export interface FeedbackVote {
  id?: string;
  feedbackId?: string;
  userId?: string;
  value?: number;
  createdAt?: string;
}

/** @stub Phase 5 */
export interface RoadmapItem {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  targetDate?: string;
  feedbackIds?: string[];
}

/** @stub Phase 5 */
export interface ChangelogEntry {
  id?: string;
  version?: string;
  title?: string;
  content?: string;
  publishedAt?: string;
  tags?: string[];
}

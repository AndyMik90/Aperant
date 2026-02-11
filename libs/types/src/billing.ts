/**
 * Billing types
 *
 * @stub Phase 3 — All fields optional until billing is implemented.
 */

import type { Tier } from './cloud';

/** @stub Phase 3 */
export interface Subscription {
  id?: string;
  userId?: string;
  tier?: Tier;
  status?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
}

/** @stub Phase 3 */
export interface BillingPlan {
  id?: string;
  name?: string;
  tier?: Tier;
  priceMonthly?: number;
  priceYearly?: number;
  currency?: string;
  features?: string[];
}

/** @stub Phase 3 */
export interface InvoiceItem {
  id?: string;
  subscriptionId?: string;
  description?: string;
  amount?: number;
  currency?: string;
  createdAt?: string;
}

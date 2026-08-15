import { paperPlan, type PaperFeature } from "../shared/paper"

export interface SubscriptionUser {
  subscriptionPlan?: unknown
  subscriptionStatus?: unknown
  subscriptionExpiresAt?: unknown
}

export function hasActiveSubscription(user: SubscriptionUser | null | undefined, feature: PaperFeature): boolean {
  if (!user || String(user.subscriptionStatus || "inactive") !== "active") return false
  const expiry = user.subscriptionExpiresAt ? new Date(String(user.subscriptionExpiresAt)) : null
  if (expiry && (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now())) return false
  const plan = paperPlan(String(user.subscriptionPlan || "reader"))
  return Boolean(plan[feature])
}

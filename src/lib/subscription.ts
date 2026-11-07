/** Subscription state from the plan's end date and its grace period.
 * Active until the end date; then "grace" for the plan's grace days (the
 * business works, with a renewal reminder); then "ended". Whether "ended"
 * locks the business is a platform setting (off by default), so turning
 * grace periods on never locks anyone by surprise. */

/** Super Admin > Subscription Plans: lock businesses whose plan and grace period have ended. */
export const ENFORCE_EXPIRY_SETTING = "platform.enforce_expiry";
export const DEFAULT_GRACE_DAYS = 7;

export type SubscriptionPhase = { phase: "active" | "none" } | { phase: "grace"; endedOn: string; graceUntil: string; daysLeft: number } | { phase: "ended"; endedOn: string; graceUntil: string };

export function subscriptionPhase(expiresAt: string | null | undefined, graceDays: number | null | undefined, now = new Date()): SubscriptionPhase {
  if (!expiresAt) return { phase: "none" };
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return { phase: "none" };
  if (now <= end) return { phase: "active" };
  const grace = Math.max(0, Math.round(graceDays ?? DEFAULT_GRACE_DAYS));
  const until = new Date(end.getTime() + grace * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  if (now <= until) return { phase: "grace", endedOn: day(end), graceUntil: day(until), daysLeft: Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 86_400_000)) };
  return { phase: "ended", endedOn: day(end), graceUntil: day(until) };
}

/** Free trial (demo account): the plan's features for TRIAL_DAYS, then the
 * business pauses until the owner confirms the subscription. */
export const TRIAL_DAYS = 3;
export const TRIAL_STATUS = "trial";

export type TrialState = { trial: false } | { trial: true; ended: boolean; endsOn: string; daysLeft: number };

export function trialState(status: string | null | undefined, expiresAt: string | null | undefined, now = new Date()): TrialState {
  if (status !== TRIAL_STATUS) return { trial: false };
  const end = expiresAt ? new Date(expiresAt) : null;
  if (!end || Number.isNaN(end.getTime())) return { trial: true, ended: true, endsOn: "", daysLeft: 0 };
  const ms = end.getTime() - now.getTime();
  return { trial: true, ended: ms <= 0, endsOn: end.toISOString().slice(0, 10), daysLeft: Math.max(0, Math.ceil(ms / 86_400_000)) };
}

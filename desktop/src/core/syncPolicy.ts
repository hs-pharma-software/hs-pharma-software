/** When MAVIN Offline talks to MAVIN.pk: only when there is something to do.
 * - Something saved here is waiting: sent at once, and again until it arrives.
 * - The connection comes back, or the app starts.
 * - Something saved online from this computer: the offline stock catches up.
 * - Screens in use: the local copy is brought up to date when they read it.
 * - Back at the window after a while.
 * - "Sync now".
 * A computer left alone with nothing waiting asks nothing, except to renew its
 * offline selling allowance before it ends. */

/** A copy older than this does not answer an online screen: MAVIN.pk does, while the copy is brought up to date. */
export const COPY_FRESH_MS = 2 * 60_000;
/** Back at the window after this long: changes made elsewhere are fetched, so they are here if the internet drops. */
export const REFRESH_AFTER_AWAY_MS = 10 * 60_000;
/** After saves made online from here, the offline stock and prices catch up this long after the last one. */
export const AFTER_SAVE_MS = 60_000;
/** The offline allowance is renewed when less than this is left of it... */
export const RENEW_ALLOWANCE_MS = 24 * 3_600_000;
/** ...asking at most this often. */
export const RENEW_RETRY_MS = 3_600_000;

/** Whether the regular check has a reason to sync (a failed send waits for its own back-off). */
export function syncNeeded(s: { hasUnsent: boolean; allowanceEndsAt: string | null | undefined; lastSyncAt: number; now: number }): boolean {
  if (s.hasUnsent) return true;
  const ends = s.allowanceEndsAt ? Date.parse(s.allowanceEndsAt) : NaN;
  return Number.isFinite(ends) && ends - s.now < RENEW_ALLOWANCE_MS && s.now - s.lastSyncAt >= RENEW_RETRY_MS;
}

/** Whether the copy that caught up from `caughtUpFrom` may still answer a screen. */
export const copyFresh = (caughtUpFrom: number, now: number) => now - caughtUpFrom <= COPY_FRESH_MS;

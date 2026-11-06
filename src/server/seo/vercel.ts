/** Vercel deployment status (read-only) for the SEO overview and monthly
 * report: is the live site on a healthy deployment, and how did deployments
 * go this month. Needs VERCEL_API_TOKEN and VERCEL_PROJECT_ID (and
 * VERCEL_TEAM_ID when the project belongs to a team). Never changes anything. */
import { defaultHttp, type Http } from "./google";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface VercelConfig { token: string; projectId: string; teamId: string | null }

export function vercelConfig(env: Record<string, string | undefined> = process.env): VercelConfig | null {
  const token = env.VERCEL_API_TOKEN?.trim();
  const projectId = env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: env.VERCEL_TEAM_ID?.trim() || null };
}

export interface Deployment { id: string; state: string; createdAt: string; commit: string | null; message: string | null; branch: string | null }
export interface DeploySummary { latest: Deployment | null; lastReady: Deployment | null; recent: Deployment[] }

type Raw = { uid?: string; readyState?: string; state?: string; created?: number; createdAt?: number; meta?: Record<string, string | undefined> };

export function toDeployment(d: Raw): Deployment {
  return {
    id: String(d.uid ?? ""),
    state: String(d.readyState ?? d.state ?? "UNKNOWN"),
    createdAt: new Date(Number(d.created ?? d.createdAt ?? 0)).toISOString(),
    commit: d.meta?.githubCommitSha?.slice(0, 7) ?? null,
    // First line only; commit messages are ours but may be long.
    message: d.meta?.githubCommitMessage?.split("\n")[0].slice(0, 120) ?? null,
    branch: d.meta?.githubCommitRef ?? null,
  };
}

/** Production deployments, newest first (since `since`, up to 100). */
export async function productionDeployments(cfg: VercelConfig, o: { http?: Http; since?: Date; limit?: number } = {}): Promise<Deployment[]> {
  const q = new URLSearchParams({ projectId: cfg.projectId, target: "production", limit: String(o.limit ?? 50) });
  if (o.since) q.set("since", String(o.since.getTime()));
  if (cfg.teamId) q.set("teamId", cfg.teamId);
  const res = await (o.http ?? defaultHttp)(`https://api.vercel.com/v6/deployments?${q}`, { method: "GET", headers: { Authorization: `Bearer ${cfg.token}` } });
  if (res.status !== 200) {
    const msg = (res.json as { error?: { message?: string } })?.error?.message ?? "no details";
    throw new Error(`Vercel answered ${res.status}: ${msg}.${res.status === 403 || res.status === 404 ? " Check the token's scope and VERCEL_PROJECT_ID / VERCEL_TEAM_ID." : ""}`);
  }
  return ((res.json as { deployments?: Raw[] }).deployments ?? []).map(toDeployment);
}

export function summarize(list: Deployment[]): DeploySummary {
  return { latest: list[0] ?? null, lastReady: list.find((d) => d.state === "READY") ?? null, recent: list.slice(0, 5) };
}

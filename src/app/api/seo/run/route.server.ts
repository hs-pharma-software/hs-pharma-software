/** The SEO scheduler's entry point (Vercel Cron, see vercel.json): runs every
 * enabled SEO job that is due. Only a caller with the CRON_SECRET may run it;
 * the kill switch stops everything. */
import { jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { runDueJobs } from "@/server/seo/engine";
import { SEO_JOBS } from "@/server/seo/jobs";
import { cronAuthorized } from "@/server/seo/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  try {
    if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) throw new HttpError(401, "Not authorized.");
    const results = await runDueJobs(sqlForServer(), SEO_JOBS);
    return Response.json({ ran: results.map((r) => ({ status: r.status, attempts: r.attempts })) });
  } catch (e) {
    return jsonError(e);
  }
}

/** Daily fallback check of payments still waiting for a provider answer
 * (Vercel Cron, see vercel.json). Asks each provider for the status of
 * attempts left pending; only signed or inquired answers change anything.
 * Only a caller with the CRON_SECRET may run it. */
import { jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { reconcilePending } from "@/server/payments";
import { cronAuthorized } from "@/server/seo/cron";
import { pruneChanges } from "@/server/offline/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  try {
    if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) throw new HttpError(401, "Not authorized.");
    const sql = sqlForServer();
    const payments = await reconcilePending(sql, 50);
    // Same nightly run: trim the offline desktop change log (45 days kept).
    const offline = await pruneChanges(sql).catch(() => ({ removed: -1 }));
    return Response.json({ ...payments, offlineChangesRemoved: offline.removed }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

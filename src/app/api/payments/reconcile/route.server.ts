/** Daily fallback check of payments still waiting for a provider answer
 * (Vercel Cron, see vercel.json). Asks each provider for the status of
 * attempts left pending; only signed or inquired answers change anything.
 * Only a caller with the CRON_SECRET may run it. */
import { jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { reconcilePending } from "@/server/payments";
import { cronAuthorized } from "@/server/seo/cron";
import { pruneChanges } from "@/server/offline/service";
import { pruneDataChanges } from "@/server/replica";
import { sweep as praSweep } from "@/server/pra/service";

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
    // And the desktop local copy's change log (45 days kept).
    const copy = await pruneDataChanges(sql).catch(() => ({ removed: -1 }));
    // PRA: bills never handed to PRA and sends that never left (the restaurant screen also runs this every minute).
    const pra = await praSweep(sql).catch(() => ({ error: 1 }));
    return Response.json({ ...payments, offlineChangesRemoved: offline.removed, dataChangesRemoved: copy.removed, pra }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

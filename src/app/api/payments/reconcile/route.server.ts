/** Daily fallback check of payments still waiting for a provider answer
 * (Vercel Cron, see vercel.json). Asks each provider for the status of
 * attempts left pending; only signed or inquired answers change anything.
 * Only a caller with the CRON_SECRET may run it. */
import { jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { reconcilePending } from "@/server/payments";
import { cronAuthorized } from "@/server/seo/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  try {
    if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) throw new HttpError(401, "Not authorized.");
    return Response.json(await reconcilePending(sqlForServer(), 50), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

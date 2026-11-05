/** Super Admin > Queries (src/server/queries.ts). Super Admin only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { listQueries, openQuery, unreadCount } from "@/server/queries";
import { sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const sql = sqlForServer();
    const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; filter?: string; q?: string };
    switch (b.action) {
      case "unread": return Response.json({ result: { unread: await unreadCount(sql, caller) } });
      case "list": return Response.json({ result: await listQueries(sql, caller, b) });
      case "open":
        if (!b.id) throw new HttpError(400, "Missing id.");
        return Response.json({ result: await openQuery(sql, caller, b.id) });
      default: throw new HttpError(400, "Unknown action.");
    }
  } catch (e) {
    return jsonError(e);
  }
}

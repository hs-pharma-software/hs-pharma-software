/** Mavin Pharmacy Offline: the approved pharmacy catalogue (download only, no
 * login; only MAVIN's shared catalogue rows). See src/server/standalone/catalogue.ts. */
import { jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { cataloguePage } from "@/server/standalone/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const u = new URL(req.url);
    const r = await cataloguePage(sqlForServer(), { since: u.searchParams.get("since"), version: u.searchParams.get("version") });
    return Response.json(r, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (e) {
    return jsonError(e);
  }
}

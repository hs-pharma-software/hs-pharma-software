/** Shared catalogue prices: usual prices, "has the retail price gone up?" and
 * this week's increases (src/server/catalogPrices.ts). Business logins. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { catalogPricesAction } from "@/server/catalogPrices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Response.json({ result: await catalogPricesAction(sqlForServer(), caller, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

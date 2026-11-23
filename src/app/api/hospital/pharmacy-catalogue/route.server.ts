/** Hospital > Pharmacy Department: the linked pharmacy's stocked generics and brands (src/server/pharmacyBrands.ts). */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { pharmacyCatalogue } from "@/server/pharmacyBrands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await pharmacyCatalogue(sqlForServer(), caller, b);
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

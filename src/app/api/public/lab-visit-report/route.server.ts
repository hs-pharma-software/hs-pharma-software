/** The online diagnostic-lab report behind the QR code on the receipt and the
 * printed report: no login, the visit's random token is the key. */
import { clientIp, jsonError, HttpError } from "@/server/db";
import { getPublicLabVisitReport } from "@/server/labVisitReport";
import { sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recent = new Map<string, number[]>();

export async function GET(req: Request): Promise<Response> {
  try {
    // Plenty for a patient reloading; stops anyone trying tokens in bulk.
    const key = clientIp(req) ?? "?";
    const calls = (recent.get(key) ?? []).filter((t) => Date.now() - t < 60_000);
    if (calls.length >= 30) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
    recent.set(key, [...calls, Date.now()]);
    const token = new URL(req.url).searchParams.get("token") ?? "";
    return Response.json({ report: await getPublicLabVisitReport(sqlForServer(), token) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

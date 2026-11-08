/** Provider callbacks (no login; one fixed address on app.mavin.pk for every
 * business). The attempt and its merchant come from the reference in the
 * callback, and nothing changes unless the adapter verifies the signature with
 * that merchant's secret and the amount and currency match. */
import { jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { handleCallback } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function params(req: Request): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  new URL(req.url).searchParams.forEach((v, k) => { if (k !== "p") out[k] = v; });
  if (req.method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) if (v != null) out[k] = String(v);
    } else {
      const f = await req.formData().catch(() => null);
      f?.forEach((v, k) => { if (typeof v === "string") out[k] = v; });
    }
  }
  return out;
}

async function handle(req: Request): Promise<Response> {
  try {
    const provider = new URL(req.url).searchParams.get("p");
    const r = await handleCallback(sqlForServer(), provider, await params(req));
    return Response.json({ ok: true, status: r.status });
  } catch (e) {
    return jsonError(e);
  }
}

export const POST = handle;
export const GET = handle;

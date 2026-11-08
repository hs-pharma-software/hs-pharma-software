/** Where the customer's browser comes back from the provider's page. It proves
 * nothing about the payment: it only sends the person to the page saved for
 * that attempt when it started (built from a verified website address), which
 * then shows the status the server has. No other destination is possible. */
import { sqlForServer } from "@/server/subSupersApi";
import { platformUrl } from "@/server/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ref = (url.searchParams.get("ref") ?? "").slice(0, 40);
  let to = platformUrl("/");
  if (/^[A-Z0-9]{6,40}$/.test(ref)) {
    const r = (await sqlForServer().execute(`SELECT return_url FROM payment_attempts WHERE reference = ?`, [ref]).catch(() => ({ rows: [] }))).rows[0];
    if (r?.return_url && /^https:\/\//.test(String(r.return_url))) {
      const back = new URL(String(r.return_url));
      back.searchParams.set("payment", ref);
      to = back.toString();
    }
  }
  return new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store" } });
}

export const GET = handle;
export const POST = handle;

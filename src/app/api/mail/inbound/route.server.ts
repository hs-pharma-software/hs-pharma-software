/** Resend's "email.received" webhook (set its URL to https://app.mavin.pk/api/mail/inbound/).
 * Only signed requests (RESEND_WEBHOOK_SECRET) are accepted; the message itself is then fetched from Resend. */
import { sqlForServer } from "@/server/subSupersApi";
import { handleWebhook, verifyWebhook } from "@/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return Response.json({ error: "Not configured." }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Too large." }, { status: 413 });
  const ok = verifyWebhook(raw, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, secret);
  if (!ok) return Response.json({ error: "Invalid signature." }, { status: 401 });
  try {
    const result = await handleWebhook(sqlForServer(), JSON.parse(raw));
    return Response.json(result);
  } catch (e) {
    // A failure is retried by Resend; "Check for new mail" also picks it up.
    return Response.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}

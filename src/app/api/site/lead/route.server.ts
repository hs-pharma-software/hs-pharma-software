/** Demo / contact requests from the public site (src/server/leads.ts). */
import { clientIp } from "@/server/db";
import { checkLead, leadDelivery, LeadError, type LeadInput } from "@/server/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = (await req.json().catch(() => ({}))) as LeadInput;
    const lead = checkLead(input, clientIp(req));
    // A bot gets the same answer as a person, so it learns nothing.
    if (lead) await leadDelivery().deliver(lead);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof LeadError) return Response.json({ error: e.message, fields: e.fields }, { status: e.status });
    return Response.json({ error: "The request could not be sent. Please try again." }, { status: 500 });
  }
}

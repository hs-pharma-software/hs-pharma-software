/** Demo / contact requests from the public site: checked (src/server/leads.ts),
 * then saved as a query (src/server/queries.ts). The visitor sees success only
 * after the query is saved. */
import { clientIp } from "@/server/db";
import { checkLead, LeadError, type LeadInput } from "@/server/leads";
import { saveQuery } from "@/server/queries";
import { sqlForServer } from "@/server/subSupersApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = (await req.json().catch(() => ({}))) as LeadInput;
    const lead = checkLead(input, clientIp(req));
    // A bot gets the same answer as a person, so it learns nothing; nothing is saved for it.
    if (lead) await saveQuery(sqlForServer(), lead);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof LeadError) return Response.json({ error: e.message, fields: e.fields }, { status: e.status });
    // No details: the visitor's data must not appear in responses or logs.
    return Response.json({ error: "Your message could not be saved. Please try again in a moment." }, { status: 503 });
  }
}

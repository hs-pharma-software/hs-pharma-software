/** Demo / contact requests from the public site: checked (src/server/leads.ts),
 * then saved as a query (src/server/queries.ts). The visitor sees success only
 * after the query is saved. */
import { clientIp } from "@/server/db";
import { checkLead, LeadError, type LeadInput } from "@/server/leads";
import { saveQuery } from "@/server/queries";
import { sqlForServer } from "@/server/subSupersApi";
import { resendMailer } from "@/server/mailer";
import { sendWindowsRequest } from "@/server/windowsRequest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const input = (await req.json().catch(() => ({}))) as LeadInput;
    const lead = checkLead(input, clientIp(req));
    // A bot gets the same answer as a person, so it learns nothing; nothing is saved for it.
    if (!lead) return Response.json({ ok: true });
    const sql = sqlForServer();
    const saved = await saveQuery(sql, lead);
    // Windows app: the download link and a demo login by email, once per request.
    if (lead.kind === "windows") {
      const send = resendMailer();
      if (!send) return Response.json({ ok: true, emailed: false });
      if (!saved.duplicate) {
        try {
          await sendWindowsRequest(sql, send, lead);
        } catch {
          return Response.json({ ok: true, emailed: false });
        }
      }
      return Response.json({ ok: true, emailed: true });
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof LeadError) return Response.json({ error: e.message, fields: e.fields }, { status: e.status });
    // No details: the visitor's data must not appear in responses or logs.
    return Response.json({ error: "Your message could not be saved. Please try again in a moment." }, { status: 503 });
  }
}

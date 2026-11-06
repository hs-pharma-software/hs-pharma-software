/** A login's recovery email and mobile: its own (needs the current password),
 * the owner's for logins of their business, or any for the Super Admin. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { getContact, setContact } from "@/server/recovery";
import { mailConfigured } from "@/server/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req, { allowDistributor: true });
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = typeof b.userId === "string" && b.userId ? b.userId : caller.userId;
    const sql = sqlForServer();
    if (b.action === "get") return Response.json({ ...(await getContact(sql, caller, userId)), emailReady: mailConfigured() });
    if (b.action === "set") return Response.json(await setContact(sql, caller, userId, { email: b.email, mobile: b.mobile, currentPassword: b.currentPassword }));
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return jsonError(e);
  }
}

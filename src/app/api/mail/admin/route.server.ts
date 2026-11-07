/** Super Admin > Mail (src/server/mail.ts). Super Admin only. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as mail from "@/server/mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "super_admin") throw new HttpError(403, "Only the platform owner can use Mail.");
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const id = typeof b.id === "string" ? b.id : "";
    let result: unknown;
    switch (b.action) {
      case "mailboxes":
        result = { mailboxes: await mail.listMailboxes(sql), domain: mail.MAIL_DOMAIN, sending: Boolean(process.env.RESEND_API_KEY?.trim()), webhook: Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim()) };
        break;
      case "createMailbox": result = await mail.createMailbox(sql, b.local, b.name); break;
      case "removeMailbox": result = await mail.removeMailbox(sql, id); break;
      case "list": result = await mail.listMessages(sql, String(b.mailboxId ?? ""), { folder: b.folder, q: b.q, offset: b.offset }); break;
      case "get": result = await mail.getMessage(sql, id); break;
      case "flags": result = await mail.setFlags(sql, id, { read: b.read, archived: b.archived }); break;
      case "sync": result = await mail.syncInbox(sql); break;
      case "send": result = await mail.sendMail(sql, `admin:${caller.userId}`, { mailboxId: b.mailboxId, to: b.to, cc: b.cc, subject: b.subject, body: b.body, replyTo: b.replyTo }); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null });
  } catch (e) {
    return jsonError(e);
  }
}

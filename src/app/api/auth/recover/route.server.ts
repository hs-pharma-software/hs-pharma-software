/** Forgot password (no sign-in): step "request" emails a code, step "reset"
 * sets the new password with it (src/server/recovery.ts). */
import { clientIp, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { completeReset, requestReset } from "@/server/recovery";
import { resendMailer } from "@/server/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    if (b.action === "request") return Response.json(await requestReset(sql, b.identifier, clientIp(req), { send: resendMailer() }));
    if (b.action === "reset") return Response.json(await completeReset(sql, b.requestId, b.code, b.newPassword));
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return jsonError(e);
  }
}

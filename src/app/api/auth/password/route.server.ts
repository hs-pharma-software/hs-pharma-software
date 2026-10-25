/** Changes a password (own, or a login the caller manages). */
import { callerOf, jsonError } from "@/server/db";
import { setPassword } from "@/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const { userId, newPassword } = (await req.json()) as { userId?: string; newPassword?: string };
    await setPassword(caller, userId ?? caller.userId, newPassword ?? "");
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

/** Whether the browser still has a valid session, and for whom. */
import { callerOf, jsonError } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const c = await callerOf(req);
    return Response.json({ userId: c.userId, role: c.role, tenantId: c.tenantId });
  } catch (e) {
    return jsonError(e);
  }
}

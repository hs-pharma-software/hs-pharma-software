/** The signed-in user changes their own display name. */
import { callerOf, jsonError } from "@/server/db";
import { setOwnDisplayName } from "@/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req, { allowDistributor: true });
    const { displayName } = (await req.json().catch(() => ({}))) as { displayName?: unknown };
    return Response.json({ displayName: await setOwnDisplayName(caller, displayName) });
  } catch (e) {
    return jsonError(e);
  }
}

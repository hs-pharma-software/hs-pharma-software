/** Creates a login (owner: staff of their business; Super Admin: any). */
import { callerOf, jsonError } from "@/server/db";
import { createLogin, type NewLogin } from "@/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    const body = (await req.json()) as NewLogin;
    return Response.json(await createLogin(caller, body));
  } catch (e) {
    return jsonError(e);
  }
}

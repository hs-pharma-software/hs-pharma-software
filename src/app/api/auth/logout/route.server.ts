/** Ends the session: the cookie is cleared. */
import { sessionCookie } from "@/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const secure = new URL(req.url).protocol === "https:";
  return Response.json({ ok: true }, { headers: { "Set-Cookie": sessionCookie("", 0, secure) } });
}

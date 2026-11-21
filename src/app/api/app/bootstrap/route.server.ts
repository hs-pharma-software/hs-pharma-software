/** The Android app's start-up call (src/server/appReads.ts): the login, business, sections, branches and settings. */
import { callerOf, jsonError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { appBootstrap } from "@/server/appReads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    return Response.json(await appBootstrap(sqlForServer(), caller, req.headers.get("x-branch")), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

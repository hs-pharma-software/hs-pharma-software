/** The Billori assistant for the web version: the server holds the Gemini key.
 *   GET  -> { available }  whether the assistant is set up for this business
 *   POST { request, model?, timeoutMs? } -> { status, body } as Gemini answered */
import { callerOf, jsonError } from "@/server/db";
import { aiConfigFor, generateForCaller } from "@/server/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    return Response.json({ available: !!(await aiConfigFor(await callerOf(req))) });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    return Response.json(await generateForCaller(caller, await req.json()));
  } catch (e) {
    return jsonError(e);
  }
}

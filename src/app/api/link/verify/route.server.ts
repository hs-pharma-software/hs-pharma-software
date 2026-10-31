/** A hospital pharmacy redeems a clinic's / hospital's link token (General
 * Settings > Linked Clinic / Hospital). Runs on the server because the
 * pharmacy cannot read the clinic's token rows through /api/db. */
import { callerOf, jsonError, serverDb, HttpError } from "@/server/db";
import { LinkError, redeemLinkToken, type LinkDb } from "@/lib/businessLink";
import type { InValue } from "@libsql/client/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    if (caller.role !== "owner" || !caller.tenantId) throw new HttpError(403, "Only the pharmacy's owner login can link a clinic or hospital.");
    const { token } = (await req.json()) as { token?: string };
    const db: LinkDb = {
      async select<T>(sql: string, args: unknown[]) {
        return (await serverDb().execute({ sql, args: args as InValue[] })).rows as unknown as T[];
      },
      async execute(sql: string, args: unknown[]) {
        await serverDb().execute({ sql, args: args as InValue[] });
      },
    };
    try {
      return Response.json(await redeemLinkToken(db, { token: token ?? "", pharmacyTenantId: caller.tenantId, userId: caller.userId }));
    } catch (e) {
      if (e instanceof LinkError) throw new HttpError(400, e.message);
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}

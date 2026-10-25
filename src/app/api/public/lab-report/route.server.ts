/** The online lab report behind the report QR code: no login, the random
 * token is the key. Built on the server with the server's connection. */
import { serverDb, jsonError, HttpError } from "@/server/db";
import { getPublicLabReport, type ReportDb } from "@/lib/labReportDocument";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const io: ReportDb = {
  select: async <T,>(sql: string, params: unknown[]) => {
    const rs = await serverDb().execute({ sql, args: params as never[] });
    return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, typeof r[i] === "bigint" ? Number(r[i]) : r[i]]))) as T[];
  },
  execute: (sql: string, params: unknown[]) => serverDb().execute({ sql, args: params as never[] }),
};

export async function GET(req: Request): Promise<Response> {
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    try {
      return Response.json({ report: await getPublicLabReport(token, io) }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      throw new HttpError(404, e instanceof Error ? e.message : String(e));
    }
  } catch (e) {
    return jsonError(e);
  }
}

/** The DICOM machine API's server side: the database connection for
 * src/lib/dicomApi.ts, the machine behind a request, and the JSON replies. */
import { serverDb } from "./db";
import { authenticateMachine, touchMachine, DicomApiError, type DicomDb, type MachineRow } from "../lib/dicomApi";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const dicomIo: DicomDb = {
  select: async <T,>(sql: string, params: unknown[]) => {
    const rs = await serverDb().execute({ sql, args: params as never[] });
    return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, typeof r[i] === "bigint" ? Number(r[i]) : r[i]]))) as T[];
  },
  execute: (sql: string, params: unknown[]) => serverDb().execute({ sql, args: params as never[] }),
};

/** The machine whose key is in the Authorization (Bearer) or X-Api-Key header. */
export async function machineOf(req: Request): Promise<MachineRow> {
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(.+)$/i.exec(auth)?.[1] ?? req.headers.get("x-api-key");
  const m = await authenticateMachine(dicomIo, key);
  await touchMachine(dicomIo, m);
  return m;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const raw = await req.text();
  if (raw.length > 100_000) throw new DicomApiError(413, "The request is too large.");
  try {
    const v = JSON.parse(raw || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new DicomApiError(400, "Send a JSON object.");
  }
}

export function dicomReply(body: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
}

export function dicomError(e: unknown): Response {
  if (e instanceof DicomApiError) return dicomReply({ error: e.message }, e.status);
  if ((e as Error)?.constructor?.name === "ConfigError") return dicomReply({ error: (e as Error).message }, 500);
  return dicomReply({ error: "The server could not complete the request." }, 500);
}

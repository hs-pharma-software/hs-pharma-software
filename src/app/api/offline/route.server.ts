/** Offline desktop (src/server/offline/service.ts).
 * Device calls carry X-Mavin-Device "<id>:<secret>" (pull, push, grant, enrol);
 * enrol and provision also carry the user's own session. Management calls are
 * for the business owner (own business) and the Super Admin. */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import * as off from "@/server/offline/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  try {
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const sql = sqlForServer();
    const device = () => off.deviceFromAuth(sql, req.headers.get("x-mavin-device"));
    const status = (b.status ?? undefined) as { pending?: unknown; failed?: unknown; appVersion?: unknown } | undefined;
    let result: unknown;
    switch (b.action) {
      // Device
      case "provision": off.checkProtocol(b.protocol); result = await off.provisionDevice(sql, await callerOf(req), b); break;
      case "enrol": off.checkProtocol(b.protocol); result = await off.enrolUser(sql, await device(), await callerOf(req)); break;
      case "grant": off.checkProtocol(b.protocol); result = { grant: await off.grantFor(sql, await device()) }; break;
      case "pull": off.checkProtocol(b.protocol); result = await off.pull(sql, await device(), b.cursor, status); break;
      case "push": off.checkProtocol(b.protocol); result = { results: await off.push(sql, await device(), b.ops, status) }; break;
      case "mirror": off.checkProtocol(b.protocol); result = await off.mirrorPage(sql, await device(), b.table, b.offset, b.since); break;
      // Management
      case "devices": result = await off.listDevices(sql, await callerOf(req), await tenantOf(req, b)); break;
      case "revoke": result = await off.revokeDevice(sql, await callerOf(req), str(b.id), b.reason); break;
      case "hours": result = await off.setDeviceHours(sql, await callerOf(req), str(b.id), b.hours); break;
      case "block": result = await off.blockDevice(sql, await callerOf(req), str(b.id), true, b.reason); break;
      case "unblock": result = await off.blockDevice(sql, await callerOf(req), str(b.id), false, null); break;
      case "delete": result = await off.deleteDevice(sql, await callerOf(req), str(b.id)); break;
      case "perBranch": result = await off.setDevicesPerBranch(sql, await callerOf(req), await tenantOf(req, b), b.perBranch); break;
      case "exceptions": result = await off.listExceptions(sql, await callerOf(req), await tenantOf(req, b)); break;
      case "resolve": result = await off.resolveException(sql, await callerOf(req), str(b.id), b.note); break;
      case "held": result = await off.listHeld(sql, await callerOf(req), await tenantOf(req, b)); break;
      case "decideHeld": result = await off.decideHeld(sql, await callerOf(req), str(b.id), b.approve === true, b.note); break;
      default: throw new HttpError(400, "Unknown action.");
    }
    return Response.json({ result: result ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

const str = (v: unknown) => {
  if (typeof v !== "string" || !v) throw new HttpError(400, "Missing id.");
  return v;
};

/** The Super Admin names a business; an owner gets their own. */
async function tenantOf(req: Request, b: Record<string, unknown>) {
  const c = await callerOf(req);
  if (c.role === "super_admin") return str(b.tenantId);
  if (!c.tenantId) throw new HttpError(403, "Not available.");
  return c.tenantId;
}

/** First-run setup: only while no login exists at all. Creates the Super
 * Admin and the first business owner. */
import { jsonError, HttpError } from "@/server/db";
import { createLogin, needsSetup } from "@/server/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json({ needsSetup: await needsSetup() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    if (!(await needsSetup())) throw new HttpError(409, "Setup is already done.");
    const { admin, owner } = (await req.json()) as {
      admin?: { username: string; password: string };
      owner?: { username: string; password: string; displayName?: string | null; tenantId?: string };
    };
    if (!admin || !owner) throw new HttpError(400, "Enter both logins.");
    await createLogin(null, { username: admin.username, password: admin.password, role: "super_admin", tenantId: null });
    await createLogin(null, { username: owner.username, password: owner.password, role: "owner", tenantId: owner.tenantId ?? "tenant-default", displayName: owner.displayName ?? null });
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

/** Connection test for a machine key: which machine it is, and the server time. */
import { machineOf, dicomReply, dicomError } from "@/server/dicom";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const m = await machineOf(req);
    return dicomReply({ ok: true, machine: { code: m.machine_code, name: m.name, modality: m.modality_code, aeTitle: m.ae_title }, serverTime: new Date().toISOString() });
  } catch (e) {
    return dicomError(e);
  }
}

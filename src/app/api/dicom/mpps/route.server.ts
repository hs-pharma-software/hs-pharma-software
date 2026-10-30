/** Procedure step from a machine (DICOM MPPS): examination started, completed or discontinued. */
import { machineOf, dicomIo, dicomReply, dicomError, readJson } from "@/server/dicom";
import { postProcedureStep } from "@/lib/dicomApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const m = await machineOf(req);
    return dicomReply({ ok: true, ...(await postProcedureStep(dicomIo, m, await readJson(req))) });
  } catch (e) {
    return dicomError(e);
  }
}

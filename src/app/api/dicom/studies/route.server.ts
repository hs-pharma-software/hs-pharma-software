/** A study the PACS received (Orthanc's stable-study event): links the images to the order. */
import { machineOf, dicomIo, dicomReply, dicomError, readJson } from "@/server/dicom";
import { postStudyReceived } from "@/lib/dicomApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const m = await machineOf(req);
    return dicomReply({ ok: true, ...(await postStudyReceived(dicomIo, m, await readJson(req))) });
  } catch (e) {
    return dicomError(e);
  }
}

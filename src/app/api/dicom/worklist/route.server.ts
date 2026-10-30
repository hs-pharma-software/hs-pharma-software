/** DICOM Modality Worklist for one machine: GET with the machine key.
 * ?format=keywords returns DICOM keywords (Orthanc), else DICOM JSON. */
import { machineOf, dicomIo, dicomReply, dicomError } from "@/server/dicom";
import { getWorklist } from "@/lib/dicomApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    const m = await machineOf(req);
    const keywords = new URL(req.url).searchParams.get("format") === "keywords";
    const items = await getWorklist(dicomIo, m, keywords ? "keywords" : "dicom");
    return dicomReply(items, 200, keywords ? "application/json" : "application/dicom+json");
  } catch (e) {
    return dicomError(e);
  }
}

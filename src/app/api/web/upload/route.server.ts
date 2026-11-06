/** Website image upload (multipart: file, alt, tenantId for the Super Admin). */
import { callerOf, jsonError, HttpError } from "@/server/db";
import { sqlForServer } from "@/server/subSupersApi";
import { actorOf, assertCanEdit, managedTenant } from "@/server/web/core";
import { MAX_IMAGE_BYTES, saveImage } from "@/server/web/media";
import { isCloudinaryConfigured, uploadImageToCloudinary } from "@/lib/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    const caller = await callerOf(req);
    assertCanEdit(caller);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 64 * 1024) throw new HttpError(413, "Images must be under 5 MB.");
    const form = await req.formData();
    const tenantId = managedTenant(caller, form.get("tenantId") ?? undefined);
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new HttpError(400, "Choose an image.");
    if (!isCloudinaryConfigured()) throw new HttpError(503, "Image uploads are not set up on the server (CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET).");
    const alt = typeof form.get("alt") === "string" ? String(form.get("alt")).trim() : "";
    const buf = Buffer.from(await file.arrayBuffer());
    const result = await saveImage(sqlForServer(), actorOf(caller), tenantId, buf, alt, async (blob, folder) => ({ url: await uploadImageToCloudinary(blob, folder) }));
    return Response.json({ result });
  } catch (e) {
    return jsonError(e);
  }
}

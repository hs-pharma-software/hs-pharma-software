/** Cloudinary image upload, server side only. The cloud name and upload
 * preset are private settings (CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET,
 * no NEXT_PUBLIC_ prefix): an unsigned preset in the page would let anyone
 * upload to the account. Website images upload through /api/web/upload,
 * which checks the file and the business first (src/server/web/media.ts). */
if (typeof window !== "undefined") throw new Error("lib/cloudinary is server-only: call it from a server route.");

/** Uploads an image; `folder` keeps each business's files apart. */
export async function uploadImageToCloudinary(file: File | Blob, folder?: string): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET on the server.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);
  if (folder) formData.append("folder", folder);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { secure_url: string };
  return data.secure_url;
}

export function isCloudinaryConfigured(): boolean {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET);
}

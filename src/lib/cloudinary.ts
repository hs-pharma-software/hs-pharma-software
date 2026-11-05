/** Cloudinary image upload, server side only. The cloud name and upload
 * preset are private settings (CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET,
 * no NEXT_PUBLIC_ prefix): an unsigned preset in the page would let anyone
 * upload to the account. Nothing in the app uploads to Cloudinary today; a
 * future upload goes through a server route that calls this. */
if (typeof window !== "undefined") throw new Error("lib/cloudinary is server-only: call it from a server route.");

export async function uploadImageToCloudinary(file: File | Blob): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET on the server.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

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

/** Website images: checked by their actual bytes (JPEG, PNG, WebP or GIF;
 * never SVG, which can carry script), size and dimensions, counted against
 * the business's storage limit, uploaded to Cloudinary under the business's
 * own folder, and recorded in web_media. Prescriptions never come here. */
import { randomUUID } from "node:crypto";
import { HttpError } from "../db";
import type { Sql } from "../subSupers";
import { audit, iso, requireSite } from "./core";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 6000;

/** Type and size of an image from its first bytes; null if it is not a safe image. */
export function imageInfo(buf: Buffer): { mime: string; width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: "image/png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.subarray(0, 6).toString("latin1") === "GIF87a" || buf.subarray(0, 6).toString("latin1") === "GIF89a") return { mime: "image/gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    const kind = buf.subarray(12, 16).toString("latin1");
    if (kind === "VP8X") return { mime: "image/webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { mime: "image/webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return { mime: "image/webp", width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) }; }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    // Walk the JPEG markers to the frame header.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { mime: "image/jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  }
  return null;
}

export type Uploader = (file: Blob, folder: string) => Promise<{ url: string }>;

export async function saveImage(sql: Sql, actor: string, tenantId: string, buf: Buffer, alt: string, upload: Uploader) {
  const site = await requireSite(sql, tenantId);
  if (!site.builderAllowed) throw new HttpError(403, "Website editing is turned off for this business.");
  if (!buf.length || buf.length > MAX_IMAGE_BYTES) throw new HttpError(400, "Images must be under 5 MB.");
  const info = imageInfo(buf);
  if (!info) throw new HttpError(400, "Upload a JPG, PNG, WebP or GIF image.");
  if (!info.width || !info.height || info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) throw new HttpError(400, `Images can be at most ${MAX_IMAGE_SIDE} pixels wide or high.`);
  if (site.storageBytes + buf.length > site.limits.storageMb * 1024 * 1024) throw new HttpError(403, `Your plan's image storage (${site.limits.storageMb} MB) is full. Remove unused images first.`);
  const { url } = await upload(new Blob([new Uint8Array(buf)], { type: info.mime }), `mavin-web/${tenantId}`);
  if (!/^https:\/\//.test(url)) throw new HttpError(502, "The image service returned an unexpected address.");
  const id = randomUUID();
  await sql.batch([
    { sql: `INSERT INTO web_media (id, tenant_id, url, alt, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, tenantId, url, alt.slice(0, 160), buf.length, info.width, info.height, iso()] },
    { sql: `UPDATE web_sites SET storage_bytes = storage_bytes + ? WHERE tenant_id = ?`, args: [buf.length, tenantId] },
  ]);
  await audit(sql, tenantId, actor, "image_uploaded", { id, bytes: buf.length });
  return { id, url, alt, width: info.width, height: info.height };
}

export async function listMedia(sql: Sql, tenantId: string) {
  return (await sql.execute(`SELECT id, url, alt, bytes, width, height, created_at FROM web_media WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`, [tenantId])).rows
    .map((r) => ({ id: String(r.id), url: String(r.url), alt: String(r.alt ?? ""), bytes: Number(r.bytes), width: Number(r.width) || null, height: Number(r.height) || null }));
}

/** Removes an image from the library and frees its storage (pages that still use it keep the address). */
export async function deleteMedia(sql: Sql, actor: string, tenantId: string, id: string) {
  const r = (await sql.execute(`SELECT bytes FROM web_media WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`, [id, tenantId])).rows[0];
  if (!r) throw new HttpError(404, "Image not found.");
  await sql.batch([
    { sql: `UPDATE web_media SET deleted_at = ? WHERE id = ? AND tenant_id = ?`, args: [iso(), id, tenantId] },
    { sql: `UPDATE web_sites SET storage_bytes = MAX(0, storage_bytes - ?) WHERE tenant_id = ?`, args: [Number(r.bytes), tenantId] },
  ]);
  await audit(sql, tenantId, actor, "image_deleted", { id });
}

/** A resized, compressed Cloudinary address for responsive images (others unchanged). */
export function sizedImage(url: string, width: number): string {
  return url.replace(/(res\.cloudinary\.com\/[^/]+\/image\/upload\/)(?!f_auto)/, `$1f_auto,q_auto,c_limit,w_${Math.round(width)}/`);
}

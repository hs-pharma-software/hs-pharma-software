/** FBR tokens at rest: AES-256-GCM with FBR_TOKEN_KEY (32 bytes, base64),
 * separate from the payments key. Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "@/server/db";

function key(): Buffer {
  const raw = process.env.FBR_TOKEN_KEY?.trim();
  if (!raw) throw new HttpError(503, "FBR token storage is not set up on the server yet (FBR_TOKEN_KEY).");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new HttpError(503, "FBR_TOKEN_KEY must be 32 bytes, base64.");
  return k;
}

export const tokenStorageReady = () => {
  try { key(); return true; } catch { return false; }
};

export function sealToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function openToken(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new HttpError(500, "A stored FBR token is damaged. Enter it again in Settings > FBR.");
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "A stored FBR token cannot be read with the server's key. Enter it again in Settings > FBR.");
  }
}

/** The last 4 characters, to recognise a token without showing it. */
export const tokenHint = (t: string) => (t.length > 8 ? `••••${t.slice(-4)}` : "••••");

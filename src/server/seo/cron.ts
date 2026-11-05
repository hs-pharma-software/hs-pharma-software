/** Who may start the SEO scheduler: Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". */
import { timingSafeEqual } from "node:crypto";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

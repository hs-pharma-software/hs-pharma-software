/** "Request for Windows" on www.mavin.pk/download: the visitor's request is saved
 * as a query (Super Admin > Queries), then MAVIN.pk emails the download link and
 * a demo login. The Super Admin sets the demo logins (one per business type, and
 * one for any other) in Super Admin > Queries. */
import { WINDOWS_RELEASE } from "@/config/windowsRelease";
import { requireQueryReader } from "./queries";
import { HttpError } from "./db";
import type { Mail, SendMail } from "./mailer";
import type { Sql } from "./subSupers";

if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

const KEY = "site.windows_demo_logins";
/** The demo login for business types without their own. */
export const ANY_TYPE = "Any";

export interface DemoLogin { businessType: string; username: string; password: string; note: string }

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function readLogins(sql: Pick<Sql, "execute">): Promise<DemoLogin[]> {
  const raw = (await sql.execute(`SELECT value FROM settings WHERE key = ?`, [KEY])).rows[0]?.value;
  try {
    const v = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(v) ? v.map((x) => x as DemoLogin).filter((x) => x && x.username) : [];
  } catch {
    return [];
  }
}

/** Super Admin: the demo logins sent with Windows requests. */
export async function getDemoLogins(sql: Sql, caller: { role: string; platformRole?: string | null }): Promise<DemoLogin[]> {
  requireQueryReader(caller);
  return readLogins(sql);
}

export async function saveDemoLogins(sql: Sql, caller: { role: string; platformRole?: string | null }, input: unknown): Promise<DemoLogin[]> {
  requireQueryReader(caller);
  if (!Array.isArray(input)) throw new HttpError(400, "Send a list of demo logins.");
  const list: DemoLogin[] = input.slice(0, 40).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return { businessType: clean(o.businessType, 60) || ANY_TYPE, username: clean(o.username, 60), password: clean(o.password, 100), note: clean(o.note, 300) };
  }).filter((x) => x.username);
  const types = list.map((x) => x.businessType.toLowerCase());
  if (new Set(types).size !== types.length) throw new HttpError(400, "Each business type can have one demo login.");
  await sql.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [KEY, JSON.stringify(list), new Date().toISOString()],
  );
  return list;
}

/** The demo login for a business type, or the one for any type. */
export function demoLoginFor(list: DemoLogin[], businessType: string): DemoLogin | null {
  const t = businessType.trim().toLowerCase();
  return list.find((x) => x.businessType.toLowerCase() === t) ?? list.find((x) => x.businessType === ANY_TYPE) ?? null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function windowsRequestMail(to: string, o: { name: string; login: DemoLogin | null }): Mail {
  const W = WINDOWS_RELEASE;
  const loginText = o.login
    ? [`Demo login (to try MAVIN.pk):`, `Website: https://app.mavin.pk`, `Username: ${o.login.username}`, `Password: ${o.login.password}`, ...(o.login.note ? [o.login.note] : [])]
    : [`Our team will send you a demo login shortly.`];
  const text = [
    `Dear ${o.name},`,
    ``,
    `Thank you for your interest in ${W.appName}.`,
    ``,
    `Download ${W.appName} ${W.versionName} (${W.needs}):`,
    W.url,
    ``,
    `Install: open the downloaded file. If Windows shows "Windows protected your PC", click More info, then Run anyway. Sign in once while online; after that billing also works without internet.`,
    ``,
    ...loginText,
    ``,
    `MAVIN.pk`,
  ].join("\n");
  const loginHtml = o.login
    ? `<p><b>Demo login</b> (to try MAVIN.pk)<br>Website: <a href="https://app.mavin.pk">app.mavin.pk</a><br>Username: <b>${esc(o.login.username)}</b><br>Password: <b>${esc(o.login.password)}</b>${o.login.note ? `<br>${esc(o.login.note)}` : ""}</p>`
    : `<p>Our team will send you a demo login shortly.</p>`;
  const html = `<p>Dear ${esc(o.name)},</p>
<p>Thank you for your interest in ${esc(W.appName)}.</p>
<p><a href="${esc(W.url)}" style="display:inline-block;background:#0b2a6b;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Download ${esc(W.appName)} ${esc(W.versionName)}</a><br><small>${esc(W.needs)}</small></p>
<p>Install: open the downloaded file. If Windows shows "Windows protected your PC", click <i>More info</i>, then <i>Run anyway</i>. Sign in once while online; after that billing also works without internet.</p>
${loginHtml}
<p>MAVIN.pk</p>`;
  return { to, subject: `${W.appName}: download link and demo login`, text, html };
}

/** Emails the download link and the demo login of the visitor's business type. */
export async function sendWindowsRequest(sql: Pick<Sql, "execute">, send: SendMail, lead: { name: string; email: string; businessType: string }): Promise<void> {
  const login = demoLoginFor(await readLogins(sql), lead.businessType);
  await send(windowsRequestMail(lead.email, { name: lead.name, login }));
}

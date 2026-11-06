/** Sends the platform's emails (password recovery codes) through Resend's
 * HTTP API. Needs RESEND_API_KEY; the sender is MAIL_FROM (default
 * "MAVIN.pk <no-reply@mavin.pk>", whose domain must be verified in Resend).
 * The key stays on the server and is never logged. */
if (typeof window !== "undefined") throw new Error("src/server is server-only code.");

export interface Mail { to: string; subject: string; text: string; html: string }
export type SendMail = (m: Mail) => Promise<void>;

export const mailConfigured = (env: Record<string, string | undefined> = process.env) => Boolean(env.RESEND_API_KEY?.trim());

export function resendMailer(env: Record<string, string | undefined> = process.env): SendMail | null {
  const key = env.RESEND_API_KEY?.trim();
  if (!key) return null;
  const from = env.MAIL_FROM?.trim() || "MAVIN.pk <no-reply@mavin.pk>";
  return async (m) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(`The email service answered ${res.status}: ${body.message ?? "no details"}`);
      }
    } finally {
      clearTimeout(timer);
    }
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The recovery-code email. */
export function codeMail(to: string, o: { code: string; username: string; minutes: number }): Mail {
  const text = `Your MAVIN.pk password reset code is ${o.code}

It is for the login "${o.username}" and expires in ${o.minutes} minutes.
If you did not ask to reset your password, ignore this email: your password stays the same.

Never share this code. MAVIN.pk staff will never ask you for it.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#1f2937">
<p style="font-size:18px;font-weight:bold;color:#0b2a6b">MAVIN.pk</p>
<p>Your password reset code is:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#0b2a6b;margin:16px 0">${esc(o.code)}</p>
<p>It is for the login <b>${esc(o.username)}</b> and expires in ${o.minutes} minutes.</p>
<p style="color:#6b7280;font-size:13px">If you did not ask to reset your password, ignore this email: your password stays the same. Never share this code; MAVIN.pk staff will never ask you for it.</p>
</div>`;
  return { to, subject: `${o.code} is your MAVIN.pk reset code`, text, html };
}

/** Sent when an email or mobile matches several logins: no code, the usernames instead. */
export function chooseLoginMail(to: string, usernames: string[]): Mail {
  const list = usernames.map((u) => `- ${u}`).join("\n");
  const text = `Several MAVIN.pk logins use this email or mobile number:

${list}

To reset a password, open "Forgot password" again and enter the username of the login you want to reset.
If you did not ask for this, ignore this email.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;color:#1f2937">
<p style="font-size:18px;font-weight:bold;color:#0b2a6b">MAVIN.pk</p>
<p>Several MAVIN.pk logins use this email or mobile number:</p>
<ul>${usernames.map((u) => `<li><b>${esc(u)}</b></li>`).join("")}</ul>
<p>To reset a password, open <b>Forgot password</b> again and enter the username of the login you want to reset.</p>
<p style="color:#6b7280;font-size:13px">If you did not ask for this, ignore this email.</p>
</div>`;
  return { to, subject: "Choose which MAVIN.pk login to reset", text, html };
}
